/**
 * 定时自动写文：内容生成 + 封面生成 + 建草稿 + 到期执行。
 *
 * 复用后台既有的 AI 配置（`chatComplete`），不引入新的密钥通道；封面用
 * Workers AI 的 `@cf/black-forest-labs/flux-1-schnell`（返回 base64 JPEG），
 * 落到 R2 并写入 `media` 表，与手动上传的图片同等对待。
 *
 * 执行 -> 记录：
 *   * 每次执行先写 `automation_tasks.last_status='running'` 并给
 *     `next_run_at` 一个 10 分钟的「租约」，避免定时器重叠触发同一任务；
 *     崩溃后最多 10 分钟自动重试。
 *   * 结束后写一条 `automation_runs`（成功/失败 + 产出文章 + 错误信息），
 *     并回填任务的 last_* 与下一个 `next_run_at`。
 */
import type { AutomationPublishMode, AutomationTask, PostStatus } from '@shared/types';
import { computeNextRun, type ScheduleInput } from '@shared/schedule';
import { chatComplete, readAiSettings } from './ai';
import { runToolAgent } from './ai-agent';
import { recordAudit, type AuditActor } from './audit';
import { buildCoverPrompt, generateCoverImage, resolveFallbackCover } from './cover';
import { all, first, placeholders, run } from './db';
import { nowSql } from './datetime';
import type { Env, Role, SessionUser } from './env';
import { AppError } from './errors';
import { countWords, deriveExcerpt } from './sanitize';
import { resolveTagIds, setPostTags, uniqueSlug } from './posts-write';

// 封面相关工具函数对外保持从本模块可导入(既有测试与调用方依赖)。
export { buildCoverPrompt, generateCoverImage } from './cover';

/** 定时器单次最多处理的任务数，避免一次事件耗尽 CPU 预算。 */
export const DUE_TASK_BATCH = 3;

/** 认领任务后写入的租约时长（分钟）；崩溃后据此自动重试。 */
const LEASE_MINUTES = 10;

/* ------------------------------------------------------- 排期字段适配 */

/** 从任务行取出排期输入（UTC+8 语义）。 */
export function scheduleOf(task: AutomationTask): ScheduleInput {
  return {
    recurrence: task.recurrence,
    timeOfDay: task.time_of_day,
    weekday: task.weekday,
    dayOfMonth: task.day_of_month,
    startDate: task.start_date,
    endDate: task.end_date,
  };
}

/** 安全解析 tags_json，坏数据按空数组处理。 */
export function parseTagsJson(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/* --------------------------------------------------------- 文本生成 */

/** 去掉模型爱加的 ``` 围栏。 */
function stripFences(text: string): string {
  const trimmed = text.trim();
  const match = /^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n?```$/.exec(trimmed);
  const inner = match?.[1];
  return inner ? inner.trim() : trimmed;
}

export interface GeneratedArticle {
  title: string;
  contentMd: string;
}

/**
 * 从模型输出拆出标题与正文。
 *
 * 约定让模型先输出 `# 标题`，但不同模型的格式习惯不一致，因此做多层兜底：
 * 一级标题 → 任意标题 → 首个非空行。
 */
export function splitTitleAndBody(raw: string, fallbackTitle: string): GeneratedArticle {
  const text = stripFences(raw);
  const lines = text.split('\n');
  let firstIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i] ?? '').trim()) {
      firstIndex = i;
      break;
    }
  }
  if (firstIndex === -1) return { title: fallbackTitle, contentMd: '' };

  const firstLine = (lines[firstIndex] ?? '').trim();
  const heading = /^#{1,3}\s+(.+?)\s*#*$/.exec(firstLine);
  const headingTitle = heading?.[1];
  if (headingTitle) {
    const title = headingTitle.trim().slice(0, 200);
    const rest = [...lines.slice(0, firstIndex), ...lines.slice(firstIndex + 1)].join('\n').trim();
    return { title: title || fallbackTitle, contentMd: rest };
  }

  // 没有标题行：把首个非空行当标题，仅当其足够短且不像正文。
  const plain = firstLine.replace(/^#+\s*/, '').trim();
  if (plain.length > 0 && plain.length <= 60 && !/[。！？]$/.test(plain)) {
    const rest = [...lines.slice(0, firstIndex), ...lines.slice(firstIndex + 1)].join('\n').trim();
    if (rest) return { title: plain, contentMd: rest };
  }
  return { title: fallbackTitle, contentMd: text };
}

/** 用任务提示词生成一篇 Markdown 文章。 */
export async function generateArticle(env: Env, task: AutomationTask): Promise<GeneratedArticle> {
  const ai = await readAiSettings(env);
  const instruction = [
    '请按下面的要求写一篇完整的中文博客文章。',
    '',
    `写作要求：${task.prompt.trim()}`,
    '',
    '输出格式：第一行只输出 Markdown 一级标题（以 `# ` 开头，不要书名号/引号），',
    '从第二行开始输出文章正文（Markdown），不要任何额外的说明文字。',
  ].join('\n');

  const text = await chatComplete(env, [
    { role: 'system', content: ai.contentPrompt },
    { role: 'user', content: instruction },
  ]);
  const fallbackTitle = deriveExcerpt(task.prompt, 40) || task.name;
  const article = splitTitleAndBody(text, fallbackTitle);
  if (!article.contentMd.trim()) {
    throw AppError.upstream('AI 未返回文章正文，请稍后重试或调整提示词');
  }
  return article;
}

/* --------------------------------------------------------- 封面 */

/** 配图助手专用系统提示:只找/生成一张图,不碰文章与评论。 */
const COVER_AGENT_SYSTEM_PROMPT = [
  '你是 Edge Blog 定时发文流程里的配图助手,唯一任务是为给定文章配一张封面图,并存入本站媒体库。',
  '',
  '可用手段:',
  '1. 用 web_search 搜索合适的配图(例如「<主题> 高清大图 / 壁纸 / 摄影作品」),必要时用 fetch_web_page 打开候选页面确认图片直链;',
  '2. 用 upload_media_from_url 把选中的图片下载入库(必须是图片的 http/https 直链);',
  '3. 也可以用 generate_cover 直接生成一张封面。',
  '',
  '约束:',
  '- 只需产出 1 张横版封面;不要创建、修改或删除任何文章、评论或其他数据;',
  '- 除了联网搜索、读取网页、上传图片、生成封面这几件事,不要调用别的工具;',
  '- 完成后用一句话说明选用了什么图。',
].join('\n');

/** 取任务创建者作为工具调用的身份;取不到就跳过并记录原因。 */
async function taskSessionUser(env: Env, task: AutomationTask): Promise<SessionUser | null> {
  if (task.created_by == null) return null;
  const row = await first<{ username: string; role: Role }>(
    env,
    'SELECT username, role FROM users WHERE id = ?',
    task.created_by,
  );
  if (!row) return null;
  return { id: task.created_by, username: row.username, role: row.role, tokenVersion: 0 };
}

/** AI 联网找图封面:跑一轮受限的工具循环,取入库的图片地址。 */
async function generateAgentCover(env: Env, task: AutomationTask, title: string): Promise<string | null> {
  const actor = await taskSessionUser(env, task);
  if (!actor) {
    console.error('[automation] agent 封面跳过:任务创建者已不存在', task.id);
    return null;
  }
  const hint = task.cover_prompt.trim();
  const message = [
    `文章标题:${title}`,
    `写作主题:${task.prompt.trim()}`,
    hint ? `封面要求:${hint}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const result = await runToolAgent(env, actor, COVER_AGENT_SYSTEM_PROMPT, message, { maxRounds: 3 });
    const urls = result.uploadedImageUrls;
    return urls[urls.length - 1] ?? null;
  } catch (err) {
    console.error('[automation] agent 封面失败', err);
    return null;
  }
}

/**
 * 按任务配置解析封面地址:
 *   ai       → Workers AI 生成并入库
 *   agent    → AI 联网找图并入库
 *   fallback → 指定图片(本站地址直接引用,外链下载入库)
 *   none     → 无封面
 */
async function resolveCover(env: Env, task: AutomationTask, title: string): Promise<string | null> {
  switch (task.cover_mode) {
    case 'ai':
      return generateCoverImage(env, buildCoverPrompt(task, title));
    case 'agent':
      return generateAgentCover(env, task, title);
    case 'fallback':
      return resolveFallbackCover(env, task.cover_url);
    default:
      return null;
  }
}

/* --------------------------------------------------------- 建草稿 */

interface CreateDraftInput {
  title: string;
  contentMd: string;
  coverUrl: string | null;
  columnId: number | null;
  tags: string[];
  authorId: number | null;
  /** 生成后的处理方式：草稿或直接发布。 */
  publishMode: AutomationPublishMode;
}

/**
 * 生成文章的最终状态：`publish` 直接上线（需同时写 `published_at`），
 * 否则存草稿等待人工审核。抽成纯函数便于单测。
 */
export function resolveAutomationStatus(mode: AutomationPublishMode): {
  status: PostStatus;
  publish: boolean;
} {
  return mode === 'publish' ? { status: 'published', publish: true } : { status: 'draft', publish: false };
}

/**
 * 生成一篇文章，返回 id/slug。
 *
 * `publishMode = 'publish'` 时直接置为已发布并写入 `published_at`（公开可见
 * 需要 `status IN ('published','scheduled')` 且 `published_at <= now`，
 * 见 post-scope.ts）；否则保存为草稿，等人工审核后再发布。
 */
async function createDraftPost(env: Env, input: CreateDraftInput): Promise<{ id: number; slug: string }> {
  const slug = await uniqueSlug(env, input.title, null);
  const excerpt = deriveExcerpt(input.contentMd);
  const { status, publish } = resolveAutomationStatus(input.publishMode);
  const publishedAt = publish ? nowSql() : null;

  const result = await run(
    env,
    `INSERT INTO posts
       (slug, title, excerpt, content_md, cover_url, status, published_at,
        meta_title, meta_description, og_image, word_count, featured, author_id, column_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, 0, ?, ?)`,
    slug,
    input.title,
    excerpt,
    input.contentMd,
    input.coverUrl,
    status,
    publishedAt,
    countWords(input.contentMd),
    input.authorId,
    input.columnId,
  );
  const id = Number(result.meta.last_row_id);
  // 专栏文章不参与标签体系，与 /api/posts 的规则保持一致。
  if (input.columnId == null && input.tags.length > 0) {
    await setPostTags(env, id, await resolveTagIds(env, input.tags));
  }
  return { id, slug };
}

/* --------------------------------------------------------- 执行 */

export interface AutomationExecResult {
  status: 'success' | 'failed';
  message: string;
  postId: number | null;
  postSlug: string | null;
  coverUrl: string | null;
}

/**
 * 真正执行一次生成（不含任务状态维护）。抛出的错误由调用方转成失败记录。
 */
async function performGeneration(env: Env, task: AutomationTask): Promise<AutomationExecResult> {
  const ai = await readAiSettings(env);
  if (!ai.enabled) {
    throw AppError.badRequest('AI 功能尚未启用，请先在「AI 设置」中开启');
  }

  const article = await generateArticle(env, task);

  // 封面是可选产物:生成/下载失败时按 null 处理,不影响正文落库。
  const coverUrl = await resolveCover(env, task, article.title);

  const { id, slug } = await createDraftPost(env, {
    title: article.title,
    contentMd: article.contentMd,
    coverUrl,
    columnId: task.column_id,
    tags: parseTagsJson(task.tags_json),
    authorId: task.created_by,
    publishMode: task.publish_mode,
  });

  const verb = task.publish_mode === 'publish' ? '已发布《' : '已生成草稿《';
  return {
    status: 'success',
    message: `${verb}${article.title}》`,
    postId: id,
    postSlug: slug,
    coverUrl,
  };
}

/** 任务的作者信息，用于审计与文章署名。 */
function taskActor(task: AutomationTask): AuditActor | null {
  if (task.created_by == null) return null;
  return { id: task.created_by, username: task.created_by_name || `user-${task.created_by}` };
}

async function writeRun(
  env: Env,
  taskId: number,
  result: AutomationExecResult,
  startedAt: string,
): Promise<void> {
  await run(
    env,
    `INSERT INTO automation_runs
       (task_id, status, message, post_id, post_slug, cover_url, started_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    taskId,
    result.status,
    result.message.slice(0, 1000),
    result.postId,
    result.postSlug,
    result.coverUrl,
    startedAt,
  );
}

/**
 * 执行一个任务：维护 running 状态、写运行记录、回填 last_* 与下次运行时间。
 *
 * @param claimed 定时轮询已通过条件 UPDATE 认领（已置 running 与租约）时为 true；
 *                手动触发时为 false，需要在此处自行置 running。
 */
export async function executeAutomationTask(
  env: Env,
  task: AutomationTask,
  options: { claimed?: boolean; actor?: SessionUser | AuditActor | null } = {},
): Promise<AutomationExecResult> {
  const startedAt = nowSql();
  if (!options.claimed) {
    await run(
      env,
      'UPDATE automation_tasks SET last_status = ?, last_run_at = ? WHERE id = ?',
      'running',
      startedAt,
      task.id,
    );
  }

  let result: AutomationExecResult;
  try {
    result = await performGeneration(env, task);
  } catch (err) {
    const message = err instanceof Error ? err.message : '生成失败';
    result = { status: 'failed', message, postId: null, postSlug: null, coverUrl: null };
  }

  const nextRunAt = task.enabled
    ? computeNextRun(scheduleOf(task), nowSql())
    : null;

  await run(
    env,
    `UPDATE automation_tasks SET
        last_status = ?, last_error = ?, last_post_id = ?, next_run_at = ?,
        updated_at = datetime('now')
      WHERE id = ?`,
    result.status,
    result.status === 'failed' ? result.message.slice(0, 1000) : null,
    result.postId,
    nextRunAt,
    task.id,
  );
  await writeRun(env, task.id, result, startedAt);

  const actor = options.actor !== undefined ? options.actor : taskActor(task);
  await recordAudit(env, actor, 'automation.run', 'automation_task', task.id, {
    status: result.status,
    trigger: options.claimed ? 'schedule' : 'manual',
    postId: result.postId,
    message: result.message.slice(0, 200),
  });

  return result;
}

/**
 * 定时器入口：挑出到期任务并执行。
 *
 * 用条件 UPDATE 认领（`next_run_at` 必须仍到期）避免定时器重叠触发同一任务；
 * 认领成功后 `next_run_at` 被推进 10 分钟，执行完再写入真正的下次时间。
 */
export async function runDueAutomationTasks(env: Env): Promise<{ picked: number; succeeded: number; failed: number }> {
  const due = await all<{ id: number }>(
    env,
    `SELECT id FROM automation_tasks
      WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= datetime('now')
      ORDER BY next_run_at ASC
      LIMIT ?`,
    DUE_TASK_BATCH,
  );

  let succeeded = 0;
  let failed = 0;
  for (const row of due) {
    const claim = await run(
      env,
      `UPDATE automation_tasks
          SET last_status = 'running',
              last_run_at = datetime('now'),
              next_run_at = datetime('now', '+${LEASE_MINUTES} minutes')
        WHERE id = ? AND enabled = 1
          AND next_run_at IS NOT NULL AND next_run_at <= datetime('now')`,
      row.id,
    );
    if (Number(claim.meta.changes ?? 0) === 0) continue; // 已被其他事件抢先。

    const task = await getAutomationTask(env, row.id);
    if (!task) continue;

    const result = await executeAutomationTask(env, task, { claimed: true });
    if (result.status === 'success') succeeded += 1;
    else failed += 1;
  }
  return { picked: due.length, succeeded, failed };
}

/* --------------------------------------------------------- 读取 */

export async function getAutomationTask(env: Env, id: number): Promise<AutomationTask | null> {
  return first<AutomationTask>(env, 'SELECT * FROM automation_tasks WHERE id = ?', id);
}

export interface AutomationTaskRowWithColumn extends AutomationTask {
  column_slug: string | null;
  column_name: string | null;
}

/** 后台列表：任务 + 归属专栏 + 最近一篇文章，便于一步渲染。 */
export async function listAutomationTasks(env: Env): Promise<AutomationTaskRowWithColumn[]> {
  return all<AutomationTaskRowWithColumn>(
    env,
    `SELECT t.*, c.slug AS column_slug, c.name AS column_name
       FROM automation_tasks t
       LEFT JOIN columns c ON c.id = t.column_id
      ORDER BY t.enabled DESC, t.next_run_at IS NULL, t.next_run_at ASC, t.id DESC`,
  );
}

export interface AutomationRunRow {
  id: number;
  task_id: number;
  status: 'success' | 'failed';
  message: string | null;
  post_id: number | null;
  post_slug: string | null;
  cover_url: string | null;
  started_at: string | null;
  finished_at: string;
  created_at: string;
}

export async function listAutomationRuns(
  env: Env,
  taskId: number,
  limit: number,
): Promise<AutomationRunRow[]> {
  return all<AutomationRunRow>(
    env,
    `SELECT id, task_id, status, message, post_id, post_slug, cover_url, started_at, finished_at, created_at
       FROM automation_runs WHERE task_id = ?
      ORDER BY id DESC LIMIT ?`,
    taskId,
    limit,
  );
}

/** 批量取最近一批运行记录里的文章状态（用于列表徽标）。 */
export async function loadPostsByIds(
  env: Env,
  ids: number[],
): Promise<Map<number, { id: number; slug: string; title: string; status: PostStatus }>> {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  if (unique.length === 0) return new Map();
  const rows = await all<{ id: number; slug: string; title: string; status: PostStatus }>(
    env,
    `SELECT id, slug, title, status FROM posts WHERE id IN (${placeholders(unique.length)})`,
    ...unique,
  );
  return new Map(rows.map((row) => [row.id, row]));
}
