import { all, first } from './db';
import type { Env } from './env';

/**
 * 判定「这个媒体正在被使用」的引用来源。
 *
 * 生产库是手工执行 SQL 升级的（见 AGENTS.md），偶尔会出现某个迁移没跑、
 * 表/列不存在的情况。这里把每个来源拆开，运行时探测存在的部分，避免整个
 * 媒体库因为一个缺失的列返回 500。探测不到的来源跳过——那种来源不可能
 * 引用任何媒体，跳过是安全的。
 */
export type UsageSource =
  | 'posts.cover_url'
  | 'posts.og_image'
  | 'posts.content_md'
  | 'columns.cover_url'
  | 'automation_tasks.cover_url'
  | 'automation_runs.cover_url'
  | 'settings.value_json';

const ALL_SOURCES: UsageSource[] = [
  'posts.cover_url',
  'posts.og_image',
  'posts.content_md',
  'columns.cover_url',
  'automation_tasks.cover_url',
  'automation_runs.cover_url',
  'settings.value_json',
];

/** 探测某个来源是否存在（SELECT 到不存在的表/列会报错，空表不会）。 */
const PROBES: Record<UsageSource, string> = {
  'posts.cover_url': 'SELECT cover_url FROM posts LIMIT 1',
  'posts.og_image': 'SELECT og_image FROM posts LIMIT 1',
  'posts.content_md': 'SELECT content_md FROM posts LIMIT 1',
  'columns.cover_url': 'SELECT cover_url FROM columns LIMIT 1',
  'automation_tasks.cover_url': 'SELECT cover_url FROM automation_tasks LIMIT 1',
  'automation_runs.cover_url': 'SELECT cover_url FROM automation_runs LIMIT 1',
  'settings.value_json': 'SELECT value_json FROM settings LIMIT 1',
};

/**
 * 按可用来源拼 SQL 条件（依赖别名 `m`）。
 *
 * 判定故意偏保守：文章封面 / OG / 正文、专栏封面、定时任务兜底封面、运行记录，
 * 以及所有设置 JSON 里只要出现过该文件的 key 或 URL 都算使用中。宁可漏清理，
 * 也不能把还能显示的图片删掉。软删除的文章也算（回收站恢复后图还要能用）。
 */
export function buildMediaInUseSql(sources: ReadonlySet<UsageSource>): string {
  const parts: string[] = [];

  const postConditions: string[] = [];
  if (sources.has('posts.cover_url')) postConditions.push('p.cover_url = m.url');
  if (sources.has('posts.og_image')) postConditions.push('p.og_image = m.url');
  if (sources.has('posts.content_md')) {
    postConditions.push(`p.content_md LIKE '%' || m.key || '%'`);
    postConditions.push(`p.content_md LIKE '%' || m.url || '%'`);
  }
  if (postConditions.length > 0) {
    parts.push(`EXISTS (SELECT 1 FROM posts p WHERE ${postConditions.join(' OR ')})`);
  }

  if (sources.has('columns.cover_url')) {
    parts.push('EXISTS (SELECT 1 FROM columns c WHERE c.cover_url = m.url)');
  }
  if (sources.has('automation_tasks.cover_url')) {
    parts.push('EXISTS (SELECT 1 FROM automation_tasks t WHERE t.cover_url = m.url)');
  }
  if (sources.has('automation_runs.cover_url')) {
    parts.push('EXISTS (SELECT 1 FROM automation_runs r WHERE r.cover_url = m.url)');
  }
  if (sources.has('settings.value_json')) {
    parts.push(
      `EXISTS (SELECT 1 FROM settings s
                WHERE s.value_json LIKE '%' || m.key || '%'
                   OR s.value_json LIKE '%' || m.url || '%')`,
    );
  }

  return `(\n    ${parts.join('\n    OR ')}\n  )`;
}

/** 全量来源（完整 schema）下的判定 SQL，测试与文档以此为准。 */
export const MEDIA_IN_USE_SQL = buildMediaInUseSql(new Set(ALL_SOURCES));

function isMissingSchema(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /no such (?:table|column)/i.test(message);
}

async function probe(env: Env, source: UsageSource): Promise<boolean> {
  try {
    await all(env, PROBES[source]);
    return true;
  } catch (err) {
    if (isMissingSchema(err)) {
      // 老库少跑了迁移：跳过这一项，别让整个媒体库不可用。
      console.warn(`[media] usage source unavailable, skipped: ${source}`);
      return false;
    }
    throw err;
  }
}

const DETECT_TTL_MS = 5 * 60_000;
let detected: { sql: string; at: number } | null = null;

/**
 * 运行时按实际 schema 生成判定 SQL（每个 isolate 缓存 5 分钟）。
 *
 * 一个来源都探测不到时直接抛错：此时把全部媒体标成「未使用」会让清理
 * 删光整个媒体库，宁可让上层降级显示错误。
 */
export async function mediaInUseSql(env: Env): Promise<string> {
  const now = Date.now();
  if (detected && now - detected.at < DETECT_TTL_MS) return detected.sql;

  const flags = await Promise.all(ALL_SOURCES.map((source) => probe(env, source)));
  const sources = new Set(ALL_SOURCES.filter((_, index) => flags[index]));
  if (sources.size === 0) {
    throw new Error('无法确认任何媒体引用来源（posts / columns / automation / settings 均不可用）');
  }
  const sql = buildMediaInUseSql(sources);
  detected = { sql, at: now };
  return sql;
}

/** 未使用文件汇总：媒体库表头与「清理」按钮都读同一份口径。 */
export async function unusedMediaSummary(
  env: Env,
  sql: string = MEDIA_IN_USE_SQL,
): Promise<{ count: number; bytes: number }> {
  const row = await first<{ count: number; bytes: number }>(
    env,
    `SELECT COUNT(*) AS count, COALESCE(SUM(m.size), 0) AS bytes
       FROM media m WHERE NOT ${sql}`,
  );
  return { count: row?.count ?? 0, bytes: row?.bytes ?? 0 };
}
