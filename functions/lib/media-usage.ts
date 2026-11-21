import { first } from './db';
import type { Env } from './env';

/**
 * 「这个媒体正在被使用」的 SQL 条件（依赖别名 `m`）。
 *
 * 判定故意偏保守：文章封面 / OG / 正文、专栏封面、定时任务兜底封面、历史运行
 * 记录，以及所有设置 JSON 里只要出现过该文件的 key 或 URL 都算使用中。
 * 宁可漏清理，也不能把还能显示的图片删掉。
 */
export const MEDIA_IN_USE_SQL = `(
  EXISTS (
    SELECT 1 FROM posts p
     WHERE p.cover_url = m.url OR p.og_image = m.url
        OR p.content_md LIKE '%' || m.key || '%'
        OR p.content_md LIKE '%' || m.url || '%'
  )
  OR EXISTS (SELECT 1 FROM columns c WHERE c.cover_url = m.url)
  OR EXISTS (SELECT 1 FROM automation_tasks t WHERE t.cover_url = m.url)
  OR EXISTS (SELECT 1 FROM automation_runs r WHERE r.cover_url = m.url)
  OR EXISTS (
    SELECT 1 FROM settings s
     WHERE s.value_json LIKE '%' || m.key || '%'
        OR s.value_json LIKE '%' || m.url || '%'
  )
)`;

/** 未使用文件汇总：媒体库表头与「清理」按钮都读同一份口径。 */
export async function unusedMediaSummary(env: Env): Promise<{ count: number; bytes: number }> {
  const row = await first<{ count: number; bytes: number }>(
    env,
    `SELECT COUNT(*) AS count, COALESCE(SUM(m.size), 0) AS bytes
       FROM media m WHERE NOT ${MEDIA_IN_USE_SQL}`,
  );
  return { count: row?.count ?? 0, bytes: row?.bytes ?? 0 };
}
