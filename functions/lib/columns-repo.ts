/**
 * 专栏（columns）的数据访问层。
 *
 * 归属模型：`posts.column_id` 为 NULL 表示博客文章，有值表示该专栏的文章，
 * 一篇文章只能属于其中一边。所有公开查询都通过 `PUBLIC_VISIBLE_SQL` 过滤，
 * 隐藏专栏里的文章因此不会漏到博客列表、标签、归档或搜索里。
 */
import type { Column, ColumnPostRef, ColumnRef, ColumnSummary, SidebarColumn } from '@shared/types';
import { all, first, placeholders } from './db';
import type { Env } from './env';
import { PUBLIC_POST_SQL, PUBLIC_VISIBLE_SQL } from './post-scope';
import { slugify } from './sanitize';

interface ColumnRow {
  id: number;
  slug: string;
  name: string;
  description: string;
  cover_url: string | null;
  sort_order: number;
  visible: 0 | 1;
  show_in_sidebar: 0 | 1;
  created_at: string;
  updated_at: string;
}

interface ColumnStatRow {
  column_id: number;
  post_count: number;
  last_published_at: string | null;
}

/** 卡片上每个专栏展示的最新文章条数。 */
export const COLUMN_CARD_LATEST = 5;
/** 侧栏分组里每个专栏展示的最新文章条数。 */
export const SIDEBAR_COLUMN_LATEST = 3;

const COLUMN_FIELDS = `c.id, c.slug, c.name, c.description, c.cover_url,
  c.sort_order, c.visible, c.show_in_sidebar, c.created_at, c.updated_at`;

/** 归属专栏的对外引用（列表/搜索/详情共用）。 */
export function toColumnRef(row: { column_id: number | null; column_slug: string | null; column_name: string | null }): ColumnRef | null {
  if (row.column_id == null || !row.column_slug || !row.column_name) return null;
  return { id: row.column_id, slug: row.column_slug, name: row.column_name };
}

export { COLUMN_FIELDS };
export type { ColumnRow };

/** 批量取专栏最新文章，供 /api/columns 与侧栏接口使用。 */
async function latestPostsByColumn(
  env: Env,
  columnIds: number[],
  limit: number,
): Promise<Map<number, ColumnPostRef[]>> {
  const map = new Map<number, ColumnPostRef[]>();
  if (columnIds.length === 0) return map;
  // 窗口函数在库端按专栏分区取前 N 条，避免把整栏文章都拉回来再截断。
  const rows = await all<ColumnPostRef & { column_id: number; rn: number }>(
    env,
    `WITH ranked AS (
       SELECT p.id, p.slug, p.title, p.published_at, p.created_at, p.column_id,
              ROW_NUMBER() OVER (
                PARTITION BY p.column_id
                ORDER BY COALESCE(p.published_at, p.created_at) DESC, p.id DESC
              ) AS rn
         FROM posts p
        WHERE p.column_id IN (${placeholders(columnIds.length)})
          AND (${PUBLIC_POST_SQL})
     )
     SELECT id, slug, title, published_at, created_at, column_id, rn
       FROM ranked
      WHERE rn <= ?
      ORDER BY column_id, rn`,
    ...columnIds,
    limit,
  );
  for (const row of rows) {
    const list = map.get(row.column_id) ?? [];
    list.push({
      id: row.id,
      slug: row.slug,
      title: row.title,
      published_at: row.published_at,
      created_at: row.created_at,
    });
    map.set(row.column_id, list);
  }
  return map;
}

/** 每个专栏的文章数与最近发文时间。 */
async function statsByColumn(
  env: Env,
  columnIds: number[],
  opts: { includeUnpublished?: boolean } = {},
): Promise<Map<number, ColumnStatRow>> {
  const map = new Map<number, ColumnStatRow>();
  if (columnIds.length === 0) return map;
  // 后台列表要看到草稿数（删除拦截也按草稿算），公开列表只统计已发布的。
  const visibility = opts.includeUnpublished ? 'p.deleted_at IS NULL' : PUBLIC_VISIBLE_SQL;
  const rows = await all<ColumnStatRow>(
    env,
    `SELECT p.column_id,
            COUNT(*) AS post_count,
            MAX(COALESCE(p.published_at, p.created_at)) AS last_published_at
       FROM posts p
      WHERE p.column_id IN (${placeholders(columnIds.length)})
        AND (${visibility})
      GROUP BY p.column_id`,
    ...columnIds,
  );
  for (const row of rows) map.set(row.column_id, row);
  return map;
}

export interface ListColumnsOptions {
  /** 后台列表：包含隐藏专栏。 */
  includeHidden?: boolean;
  /** 只要侧栏绑定的专栏（show_in_sidebar = 1）。 */
  sidebarOnly?: boolean;
  /** 统计文章数时包含草稿/定时（后台用；删除拦截也按全部文章算）。 */
  countUnpublished?: boolean;
}

/** 公开/后台共用的专栏列表，附带卡片所需的统计与最新文章。 */
export async function listColumns(env: Env, opts: ListColumnsOptions = {}): Promise<ColumnSummary[]> {
  const conditions: string[] = [];
  if (!opts.includeHidden) conditions.push('c.visible = 1');
  if (opts.sidebarOnly) conditions.push('c.show_in_sidebar = 1');
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await all<ColumnRow>(
    env,
    `SELECT ${COLUMN_FIELDS}
       FROM columns c
       ${where}
      ORDER BY c.sort_order ASC, c.id ASC`,
  );
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const [stats, latest] = await Promise.all([
    statsByColumn(env, ids, { includeUnpublished: opts.countUnpublished }),
    latestPostsByColumn(env, ids, COLUMN_CARD_LATEST),
  ]);

  return rows.map((row) => ({
    ...row,
    post_count: stats.get(row.id)?.post_count ?? 0,
    last_published_at: stats.get(row.id)?.last_published_at ?? null,
    latest: latest.get(row.id) ?? [],
  }));
}

/** 侧栏卡片：绑定的专栏 + 每栏最新 3 篇，顺序即 sort_order。 */
export async function listSidebarColumns(env: Env): Promise<SidebarColumn[]> {
  const rows = await all<ColumnRow>(
    env,
    `SELECT ${COLUMN_FIELDS}
       FROM columns c
      WHERE c.visible = 1 AND c.show_in_sidebar = 1
      ORDER BY c.sort_order ASC, c.id ASC`,
  );
  if (rows.length === 0) return [];
  const latest = await latestPostsByColumn(
    env,
    rows.map((r) => r.id),
    SIDEBAR_COLUMN_LATEST,
  );
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    latest: latest.get(row.id) ?? [],
  }));
}

/** 单个专栏（公开页面用；隐藏专栏视为不存在）。 */
export async function getColumnBySlug(
  env: Env,
  slug: string,
  opts: { includeHidden?: boolean } = {},
): Promise<Column | null> {
  const visibility = opts.includeHidden ? '' : 'AND c.visible = 1';
  return first<Column>(
    env,
    `SELECT ${COLUMN_FIELDS} FROM columns c WHERE c.slug = ? ${visibility}`,
    slug,
  );
}

export async function getColumnById(
  env: Env,
  id: number,
  opts: { includeHidden?: boolean } = {},
): Promise<Column | null> {
  const visibility = opts.includeHidden ? '' : 'AND c.visible = 1';
  return first<Column>(
    env,
    `SELECT ${COLUMN_FIELDS} FROM columns c WHERE c.id = ? ${visibility}`,
    id,
  );
}

/** 专栏内文章数（含草稿），用于删除前的拦截提示。 */
export async function countPostsInColumn(env: Env, columnId: number): Promise<number> {
  const row = await first<{ total: number }>(
    env,
    'SELECT COUNT(*) AS total FROM posts WHERE column_id = ? AND deleted_at IS NULL',
    columnId,
  );
  return row?.total ?? 0;
}

/** 找一个不被占用的专栏 slug（`ignoreId` 用于更新时排除自身）。 */
export async function uniqueColumnSlug(
  env: Env,
  base: string,
  ignoreId: number | null,
): Promise<string> {
  const root = slugify(base) || 'column';
  const rows = await all<{ id: number; slug: string }>(
    env,
    'SELECT id, slug FROM columns WHERE slug = ? OR slug LIKE ?',
    root,
    `${root}-%`,
  );
  const taken = new Set(rows.filter((r) => ignoreId === null || r.id !== ignoreId).map((r) => r.slug));
  if (!taken.has(root)) return root;
  for (let i = 2; i < 200; i++) {
    const candidate = `${root}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}
