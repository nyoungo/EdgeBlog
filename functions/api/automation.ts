/**
 * 定时自动写文接口（后台）。
 *
 *   GET    /api/automation           任务列表（含专栏与最近文章）
 *   POST   /api/automation           新建任务
 *   PUT    /api/automation/:id       更新任务
 *   DELETE /api/automation/:id       删除任务（连带运行记录）
 *   POST   /api/automation/:id/run   立即执行一次
 *   GET    /api/automation/:id/runs  运行历史
 *
 * 排期字段一律按 UTC+8（北京时间）语义收/发，服务端换算成 UTC 的
 * `next_run_at` 交给 Worker 定时器。
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AutomationTaskView, PostStatus } from '@shared/types';
import {
  computeNextRun,
  describeSchedule,
  RECURRENCE_LABELS,
  validateSchedule,
  type ScheduleInput,
} from '@shared/schedule';
import { requireAuth } from '../lib/auth';
import { recordAudit } from '../lib/audit';
import {
  executeAutomationTask,
  getAutomationTask,
  listAutomationRuns,
  listAutomationTasks,
  loadPostsByIds,
  parseTagsJson,
  scheduleOf,
  type AutomationTaskRowWithColumn,
} from '../lib/automation';
import { first, run } from '../lib/db';
import type { AppEnv, Env, SessionUser } from '../lib/env';
import { AppError } from '../lib/errors';
import { hit } from '../lib/rate-limit';
import { created, ok } from '../lib/response';
import { isHttpUrl, parseJson } from '../lib/validate';

export const automationRoutes = new Hono<AppEnv>();

automationRoutes.use('*', requireAuth);

const RECURRENCE = z.enum(['once', 'daily', 'weekly', 'monthly']);
const COVER_MODE = z.enum(['ai', 'agent', 'fallback', 'none']);
const PUBLISH_MODE = z.enum(['draft', 'publish']);
const DATE = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD');
const TIME = z.string().trim().regex(/^\d{1,2}:\d{2}$/, '时间格式应为 HH:MM');

const taskBody = z.object({
  name: z.string().trim().min(1, '任务名称不能为空').max(120),
  prompt: z.string().trim().min(1, '写作要求不能为空').max(4000),
  columnId: z.number().int().positive().nullable().optional(),
  tags: z.array(z.string().trim().max(40)).max(20).optional(),
  coverMode: COVER_MODE.optional(),
  coverPrompt: z.string().trim().max(2000).optional(),
  coverUrl: z.string().trim().max(1000).nullable().optional(),
  publishMode: PUBLISH_MODE.optional(),
  recurrence: RECURRENCE,
  timeOfDay: TIME,
  weekday: z.number().int().min(0).max(6).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  startDate: DATE,
  endDate: DATE.nullable().optional(),
  enabled: z.boolean().optional(),
});

const taskUpdateBody = taskBody.partial();

/** 封面地址:本站媒体地址(/media/...)或公网 http(s) 直链。 */
function isUsableCoverSource(value: string | null | undefined): boolean {
  const v = (value ?? '').trim();
  if (!v) return false;
  // 站内相对路径(媒体库选择的结果);`//host` 属于协议相对外链,不算站内。
  if (v.startsWith('/')) return !v.startsWith('//');
  return isHttpUrl(v);
}

/** 校验专栏存在（后台可发到隐藏专栏，与文章接口一致）。 */
async function resolveColumnId(env: Env, columnId: number | null | undefined): Promise<number | null> {
  if (columnId == null) return null;
  const row = await first<{ id: number }>(env, 'SELECT id FROM columns WHERE id = ?', columnId);
  if (!row) throw AppError.badRequest('指定的专栏不存在');
  return row.id;
}

/** 取当前用户的展示名（失败回退用户名）。 */
async function displayName(env: Env, user: SessionUser): Promise<string> {
  const row = await first<{ name: string | null }>(
    env,
    'SELECT COALESCE(display_name, username) AS name FROM users WHERE id = ?',
    user.id,
  );
  return row?.name || user.username;
}

/** 把请求体里的排期字段整理成 ScheduleInput。 */
function scheduleInputOf(body: {
  recurrence: ScheduleInput['recurrence'];
  timeOfDay: string;
  weekday?: number;
  dayOfMonth?: number;
  startDate: string;
  endDate?: string | null;
}): ScheduleInput {
  return {
    recurrence: body.recurrence,
    timeOfDay: body.timeOfDay,
    weekday: body.weekday ?? 1,
    dayOfMonth: body.dayOfMonth ?? 1,
    startDate: body.startDate,
    endDate: body.endDate ?? null,
  };
}

type PostRef = { id: number; slug: string; title: string; status: PostStatus };

/** 组装后台视图：展开标签、专栏、最近文章。 */
function toView(row: AutomationTaskRowWithColumn, posts: Map<number, PostRef>): AutomationTaskView {
  const { tags_json, column_slug, column_name, ...rest } = row;
  const found = rest.last_post_id != null ? posts.get(rest.last_post_id) ?? null : null;
  return {
    ...rest,
    tags: parseTagsJson(tags_json),
    column:
      row.column_id != null && column_slug
        ? { id: row.column_id, slug: column_slug, name: column_name ?? column_slug }
        : null,
    last_post: found,
  };
}

async function listViews(env: Env): Promise<AutomationTaskView[]> {
  const rows = await listAutomationTasks(env);
  const posts = await loadPostsByIds(
    env,
    rows.map((row) => row.last_post_id).filter((id): id is number => id != null),
  );
  return rows.map((row) => toView(row, posts));
}

async function getView(env: Env, id: number): Promise<AutomationTaskView | null> {
  const rows = await listAutomationTasks(env);
  const row = rows.find((r) => r.id === id);
  if (!row) return null;
  const posts = await loadPostsByIds(env, row.last_post_id != null ? [row.last_post_id] : []);
  return toView(row, posts);
}

/* --------------------------------------------------------------- 列表 */

automationRoutes.get('/', async (c) => {
  c.header('Cache-Control', 'no-store');
  const views = await listViews(c.env);
  return ok(c, views, { total: views.length });
});

/* --------------------------------------------------------------- 新建 */

automationRoutes.post('/', async (c) => {
  const user = c.get('user');
  if (!user) throw AppError.unauthorized();
  const body = await parseJson(c, taskBody);

  const schedule = scheduleInputOf(body);
  const scheduleError = validateSchedule(schedule);
  if (scheduleError) throw AppError.badRequest(scheduleError);

  if (body.coverMode === 'fallback' && !isUsableCoverSource(body.coverUrl)) {
    throw AppError.badRequest('指定封面需要填写图片地址:http(s) 直链,或从媒体库选择一张图片');
  }

  const columnId = await resolveColumnId(c.env, body.columnId);
  const tags = (body.tags ?? []).filter(Boolean);
  const enabled = body.enabled !== false;
  const nextRunAt = enabled ? computeNextRun(schedule, new Date()) : null;

  const result = await run(
    c.env,
    `INSERT INTO automation_tasks
       (name, prompt, column_id, tags_json, cover_mode, cover_prompt, cover_url, publish_mode,
        recurrence, time_of_day, weekday, day_of_month, start_date, end_date,
        enabled, next_run_at, created_by, created_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    body.name,
    body.prompt,
    columnId,
    JSON.stringify(columnId == null ? tags : []),
    body.coverMode ?? 'ai',
    body.coverPrompt ?? '',
    body.coverUrl ?? null,
    body.publishMode ?? 'draft',
    body.recurrence,
    body.timeOfDay,
    body.weekday ?? 1,
    body.dayOfMonth ?? 1,
    body.startDate,
    body.endDate ?? null,
    enabled ? 1 : 0,
    nextRunAt,
    user.id,
    await displayName(c.env, user),
  );

  const id = Number(result.meta.last_row_id);
  await recordAudit(c.env, user, 'automation.create', 'automation_task', id, {
    name: body.name,
    recurrence: body.recurrence,
  });
  return created(c, await getView(c.env, id));
});

/* --------------------------------------------------------------- 更新 */

automationRoutes.put('/:id', async (c) => {
  const user = c.get('user');
  if (!user) throw AppError.unauthorized();
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id)) throw AppError.badRequest('非法任务 ID');

  const existing = await getAutomationTask(c.env, id);
  if (!existing) throw AppError.notFound('任务不存在');

  const body = await parseJson(c, taskUpdateBody);

  // 合并后的排期字段：以本次提交为准，未提交的沿用旧值。
  const merged: ScheduleInput = {
    recurrence: body.recurrence ?? existing.recurrence,
    timeOfDay: body.timeOfDay ?? existing.time_of_day,
    weekday: body.weekday ?? existing.weekday,
    dayOfMonth: body.dayOfMonth ?? existing.day_of_month,
    startDate: body.startDate ?? existing.start_date,
    endDate: body.endDate !== undefined ? body.endDate : existing.end_date,
  };
  const scheduleError = validateSchedule(merged);
  if (scheduleError) throw AppError.badRequest(scheduleError);

  const columnId =
    body.columnId === undefined ? existing.column_id : await resolveColumnId(c.env, body.columnId);
  const coverMode = body.coverMode ?? existing.cover_mode;
  const coverUrl = body.coverUrl !== undefined ? body.coverUrl : existing.cover_url;
  if (coverMode === 'fallback' && !isUsableCoverSource(coverUrl)) {
    throw AppError.badRequest('指定封面需要填写图片地址:http(s) 直链,或从媒体库选择一张图片');
  }

  const enabled = body.enabled === undefined ? existing.enabled === 1 : body.enabled;
  const tags =
    body.tags !== undefined ? body.tags.filter(Boolean) : parseTagsJson(existing.tags_json);

  await run(
    c.env,
    `UPDATE automation_tasks SET
        name = ?, prompt = ?, column_id = ?, tags_json = ?, cover_mode = ?, cover_prompt = ?,
        cover_url = ?, publish_mode = ?, recurrence = ?, time_of_day = ?, weekday = ?, day_of_month = ?,
        start_date = ?, end_date = ?, enabled = ?, next_run_at = ?, updated_at = datetime('now')
      WHERE id = ?`,
    body.name ?? existing.name,
    body.prompt ?? existing.prompt,
    columnId,
    JSON.stringify(columnId == null ? tags : []),
    coverMode,
    body.coverPrompt ?? existing.cover_prompt,
    coverUrl,
    body.publishMode ?? existing.publish_mode,
    merged.recurrence,
    merged.timeOfDay,
    merged.weekday,
    merged.dayOfMonth,
    merged.startDate,
    merged.endDate ?? null,
    enabled ? 1 : 0,
    enabled ? computeNextRun(merged, new Date()) : null,
    id,
  );

  await recordAudit(c.env, user, 'automation.update', 'automation_task', id, {
    name: body.name ?? existing.name,
    enabled,
  });
  return ok(c, await getView(c.env, id));
});

/* --------------------------------------------------------------- 删除 */

automationRoutes.delete('/:id', async (c) => {
  const user = c.get('user');
  if (!user) throw AppError.unauthorized();
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id)) throw AppError.badRequest('非法任务 ID');

  const existing = await getAutomationTask(c.env, id);
  if (!existing) throw AppError.notFound('任务不存在');

  // `automation_runs` 的外键带 ON DELETE CASCADE，运行记录会一并清理。
  await run(c.env, 'DELETE FROM automation_tasks WHERE id = ?', id);
  await recordAudit(c.env, user, 'automation.delete', 'automation_task', id, { name: existing.name });
  return ok(c, { deleted: true });
});

/* --------------------------------------------------------------- 立即执行 */

automationRoutes.post('/:id/run', async (c) => {
  const user = c.get('user');
  if (!user) throw AppError.unauthorized();
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id)) throw AppError.badRequest('非法任务 ID');

  // 立即执行会真实消耗 AI 额度，按管理员账号限频。
  const limited = await hit(c.env, `automation:run:${user.id}`, 10, 300);
  if (!limited.allowed) throw AppError.rateLimited('操作过于频繁，请稍后再试');

  const task = await getAutomationTask(c.env, id);
  if (!task) throw AppError.notFound('任务不存在');

  const result = await executeAutomationTask(c.env, task, { actor: user });
  return ok(c, result);
});

/* --------------------------------------------------------------- 运行历史 */

automationRoutes.get('/:id/runs', async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id)) throw AppError.badRequest('非法任务 ID');
  const task = await getAutomationTask(c.env, id);
  if (!task) throw AppError.notFound('任务不存在');

  const limit = Math.min(50, Math.max(1, Number.parseInt(c.req.query('limit') ?? '20', 10) || 20));
  return ok(c, {
    task: {
      id: task.id,
      name: task.name,
      schedule: describeSchedule(scheduleOf(task)),
      recurrenceLabel: RECURRENCE_LABELS[task.recurrence],
    },
    runs: await listAutomationRuns(c.env, id, limit),
  });
});
