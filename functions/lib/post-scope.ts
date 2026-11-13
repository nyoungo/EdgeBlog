/**
 * 文章可见性 / 归属作用域的 SQL 片段。
 *
 * 单独成模块，避免 `posts-repo` 与 `columns-repo` 互相 import 形成循环依赖：
 * 两者都需要这几段条件，而它们只依赖 `posts`、`columns` 两张表。
 */

/** 公开可见：未进回收站、已发布或已到时间的定时文章。 */
export const PUBLIC_VISIBLE_SQL =
  "p.deleted_at IS NULL AND p.published_at IS NOT NULL AND p.published_at <= datetime('now') AND p.status IN ('published', 'scheduled')";

/**
 * 公开可见的归属：博客文章（column_id IS NULL）或可见专栏里的文章。
 * 用子查询而不是 JOIN，这样 COUNT(*) 之类不带 JOIN 的聚合也能复用同一段条件。
 */
export const PUBLIC_SCOPE_SQL =
  '(p.column_id IS NULL OR p.column_id IN (SELECT c2.id FROM columns c2 WHERE c2.visible = 1))';

/** 对外可见的完整条件（可见 + 归属可见）。 */
export const PUBLIC_POST_SQL = `${PUBLIC_VISIBLE_SQL} AND ${PUBLIC_SCOPE_SQL}`;
