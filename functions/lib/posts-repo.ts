/** Reusable post queries shared by the posts, search, rss and sitemap routes. */
import type { Post, PostNeighbour, PostStatus, PostSummary, Tag } from '@shared/types';
import { all, first, placeholders } from './db';
import { toColumnRef } from './columns-repo';
import { PUBLIC_POST_SQL } from './post-scope';
import type { Env } from './env';

// 保持既有导入路径可用（tags/search/rss 等都从这里取）。
export { PUBLIC_POST_SQL, PUBLIC_SCOPE_SQL, PUBLIC_VISIBLE_SQL } from './post-scope';

export type SortOption = 'newest' | 'oldest' | 'popular' | 'title';

interface PostRow {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  cover_url: string | null;
  status: PostStatus;
  published_at: string | null;
  meta_title: string | null;
  meta_description: string | null;
  og_image: string | null;
  word_count: number;
  featured: 0 | 1;
  views: number;
  author_id: number | null;
  column_id: number | null;
  created_at: string;
  updated_at: string;
  author_name: string | null;
  author_username: string | null;
  column_slug: string | null;
  column_name: string | null;
}

interface FullRow extends PostRow {
  content_md: string;
}

const SORT_SQL: Record<SortOption, string> = {
  newest: "p.published_at DESC NULLS LAST, p.created_at DESC",
  oldest: 'p.published_at ASC NULLS LAST, p.created_at ASC',
  popular: 'p.views DESC, p.published_at DESC',
  title: 'p.title ASC',
};

/** Escape a user query for FTS5 phrase matching. */
export function ftsQuery(input: string): string {
  return `"${input.replace(/"/g, '""')}"`;
}

const SELECT_COLUMNS = `
  p.id, p.slug, p.title, p.excerpt, p.cover_url, p.status, p.published_at,
  p.meta_title, p.meta_description, p.og_image, p.word_count,
  p.featured, p.views, p.author_id, p.column_id, p.created_at, p.updated_at,
  u.display_name AS author_name, u.username AS author_username`;

/** 列表查询总是带出归属专栏，供卡片标注与后台筛选。 */
const SELECT_COLUMNS_WITH_COLUMN = `${SELECT_COLUMNS},
  c.slug AS column_slug, c.name AS column_name`;

const POST_JOINS = `LEFT JOIN users u ON u.id = p.author_id
       LEFT JOIN columns c ON c.id = p.column_id`;

function toSummary(row: PostRow, tags: Tag[]): PostSummary {
  // toColumnRef 读 column_slug/column_name，所以这三个「不上台面」的列不能进 rest。
  const { author_username, column_slug: _column_slug, column_name: _column_name, ...rest } = row;
  void _column_slug;
  void _column_name;
  return {
    ...rest,
    author_name: row.author_name ?? author_username ?? null,
    tags,
    column: toColumnRef(row),
  };
}

export async function tagsForPosts(env: Env, ids: number[]): Promise<Map<number, Tag[]>> {
  const map = new Map<number, Tag[]>();
  if (ids.length === 0) return map;
  const rows = await all<{ post_id: number; id: number; name: string; slug: string }>(
    env,
    `SELECT pt.post_id, t.id, t.name, t.slug
       FROM post_tags pt JOIN tags t ON t.id = pt.tag_id
      WHERE pt.post_id IN (${placeholders(ids.length)})
      ORDER BY t.name`,
    ...ids,
  );
  for (const row of rows) {
    const list = map.get(row.post_id) ?? [];
    list.push({ id: row.id, name: row.name, slug: row.slug });
    map.set(row.post_id, list);
  }
  return map;
}

export interface ListPostsOptions {
  page: number;
  perPage: number;
  tag?: string | undefined;
  q?: string | undefined;
  sort?: SortOption | undefined;
  status?: PostStatus | undefined;
  featured?: boolean | undefined;
  admin?: boolean | undefined;
  /**
   * 内容作用域：
   *   `blog`    —— 只要博客文章（column_id IS NULL），博客列表/首页默认用它
   *   `all`     —— 博客 + 专栏，用于全站搜索
   *   `column`  —— 只要指定专栏的文章（配合 columnId / columnSlug）
   */
  scope?: 'blog' | 'all' | 'column' | undefined;
  /** 专栏 id 或 slug，仅 `scope: 'column'` 时生效。 */
  columnId?: number | undefined;
  columnSlug?: string | undefined;
}

export async function listPosts(
  env: Env,
  opts: ListPostsOptions,
): Promise<{ items: PostSummary[]; total: number; page: number; perPage: number; totalPages: number }> {
  const conditions: string[] = [];
  const binds: unknown[] = [];

  if (!opts.admin) conditions.push(`(${PUBLIC_POST_SQL})`);
  else conditions.push('p.deleted_at IS NULL');
  if (opts.admin && opts.status) {
    conditions.push('p.status = ?');
    binds.push(opts.status);
  }
  if (opts.featured) conditions.push('p.featured = 1');
  if (opts.tag) {
    conditions.push(
      'p.id IN (SELECT pt.post_id FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE t.slug = ?)',
    );
    binds.push(opts.tag);
  }

  // 归属作用域。admin 列表不限制归属（后台要看到全部）；公开接口默认只给博客。
  const scope = opts.scope ?? 'blog';
  if (!opts.admin) {
    if (scope === 'column') {
      if (opts.columnId != null) {
        conditions.push('p.column_id = ?');
        binds.push(opts.columnId);
      } else if (opts.columnSlug) {
        conditions.push('p.column_id = (SELECT c3.id FROM columns c3 WHERE c3.slug = ? AND c3.visible = 1)');
        binds.push(opts.columnSlug);
      } else {
        // 没有指定专栏时不返回任何内容，而不是悄悄退化成全站列表。
        conditions.push('1 = 0');
      }
    } else if (scope === 'blog') {
      conditions.push('p.column_id IS NULL');
    }
  } else if (opts.columnId != null) {
    // 后台筛选：0 表示「仅博客」，正数表示该专栏。
    if (opts.columnId === 0) conditions.push('p.column_id IS NULL');
    else {
      conditions.push('p.column_id = ?');
      binds.push(opts.columnId);
    }
  }

  if (opts.q?.trim()) {
    const trimmed = opts.q.trim();
    if (trimmed.length >= 3) {
      conditions.push('p.id IN (SELECT rowid FROM posts_fts WHERE posts_fts MATCH ?)');
      binds.push(ftsQuery(trimmed));
    } else {
      conditions.push('(p.title LIKE ? OR p.excerpt LIKE ? OR p.content_md LIKE ?)');
      const like = `%${trimmed}%`;
      binds.push(like, like, like);
    }
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const orderBy = SORT_SQL[opts.sort ?? 'newest'];
  const offset = (opts.page - 1) * opts.perPage;

  // Count and page are independent: issue them together instead of paying two
  // sequential D1 round trips per list request.
  const [countRow, rows] = await Promise.all([
    first<{ total: number }>(env, `SELECT COUNT(*) AS total FROM posts p ${where}`, ...binds),
    all<PostRow>(
      env,
      `SELECT ${SELECT_COLUMNS_WITH_COLUMN}
         FROM posts p ${POST_JOINS}
         ${where}
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?`,
      ...binds,
      opts.perPage,
      offset,
    ),
  ]);
  const total = countRow?.total ?? 0;

  const tagMap = await tagsForPosts(
    env,
    rows.map((r) => r.id),
  );
  const items = rows.map((row) => toSummary(row, tagMap.get(row.id) ?? []));

  return {
    items,
    total,
    page: opts.page,
    perPage: opts.perPage,
    totalPages: Math.max(1, Math.ceil(total / opts.perPage)),
  };
}

export async function getPostBySlug(
  env: Env,
  slug: string,
  opts: { admin?: boolean; idOnly?: boolean } = {},
): Promise<Post | null> {
  const visibility = opts.admin ? 'AND p.deleted_at IS NULL' : `AND ${PUBLIC_POST_SQL}`;
  const row = await first<FullRow>(
    env,
    `SELECT ${SELECT_COLUMNS_WITH_COLUMN}, p.content_md
       FROM posts p ${POST_JOINS}
      WHERE p.slug = ? ${visibility}`,
    slug,
  );
  if (!row) return null;
  const { author_name, author_username, column_slug, column_name, ...post } = row;
  void author_name;
  void author_username;
  void column_slug;
  void column_name;
  return post as Post;
}

export interface PostSeoRow {
  title: string;
  excerpt: string;
  meta_title: string | null;
  meta_description: string | null;
  og_image: string | null;
  cover_url: string | null;
  word_count: number;
  published_at: string | null;
  updated_at: string;
  column_slug: string | null;
  column_name: string | null;
}

/**
 * Metadata-only lookup for the HTML shell. Crawlers are by far the most
 * frequent visitor to article URLs and they never read the body, so this
 * avoids shipping `content_md` out of D1 on every crawl.
 */
export async function getPostSeoBySlug(env: Env, slug: string): Promise<PostSeoRow | null> {
  return first<PostSeoRow>(
    env,
    `SELECT p.title, p.excerpt, p.meta_title, p.meta_description, p.og_image,
            p.cover_url, p.word_count, p.published_at, p.updated_at,
            c.slug AS column_slug, c.name AS column_name
       FROM posts p
       LEFT JOIN columns c ON c.id = p.column_id
      WHERE p.slug = ? AND (${PUBLIC_POST_SQL})`,
    slug,
  );
}

export interface ArchiveEntry {
  slug: string;
  title: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Every public article, newest first, in a few tiny columns. Powers the archive
 * page and the sitemap (which previously hard-capped at the list endpoint's
 * 500-row limit, silently dropping older posts from search engines).
 *
 * `scope` 默认只给博客文章：归档是博客的时间线，专栏内容在专栏页里按栏目
 * 归档，混在一起会让博客的归档失真。全量（含专栏）留给 sitemap。
 */
export async function listArchive(
  env: Env,
  limit = 20_000,
  scope: 'blog' | 'all' = 'blog',
): Promise<ArchiveEntry[]> {
  const scopeSql = scope === 'all' ? PUBLIC_POST_SQL : `${PUBLIC_POST_SQL} AND p.column_id IS NULL`;
  return all<ArchiveEntry>(
    env,
    `SELECT p.slug, p.title, p.published_at, p.created_at, p.updated_at
       FROM posts p
      WHERE (${scopeSql})
      ORDER BY COALESCE(p.published_at, p.created_at) DESC
      LIMIT ?`,
    limit,
  );
}

export async function getPostById(env: Env, id: number): Promise<Post | null> {
  const row = await first<FullRow>(
    env,
    `SELECT ${SELECT_COLUMNS}, p.content_md
       FROM posts p LEFT JOIN users u ON u.id = p.author_id
      WHERE p.id = ? AND p.deleted_at IS NULL`,
    id,
  );
  if (!row) return null;
  const { author_name, author_username, ...post } = row;
  void author_name;
  void author_username;
  return post as Post;
}

/**
 * 上下篇只在同一归属内计算：博客文章串博客文章，专栏文章串同栏文章。
 * 否则读者从专栏文章翻页会被带到博客，破坏「专栏与博客不混合」的预期。
 */
export async function getNeighbours(
  env: Env,
  current: Post,
  admin = false,
): Promise<{ prev: PostNeighbour | null; next: PostNeighbour | null }> {
  const visibility = admin ? 'AND p.deleted_at IS NULL' : `AND ${PUBLIC_POST_SQL}`;
  const anchor = current.published_at ?? current.created_at;
  const scopeSql =
    current.column_id == null ? 'AND p.column_id IS NULL' : 'AND p.column_id = ?';
  const scopeBinds: unknown[] = current.column_id == null ? [] : [current.column_id];
  const [prev, next] = await Promise.all([
    first<PostNeighbour>(
      env,
      `SELECT p.slug, p.title FROM posts p
        WHERE 1 = 1 ${visibility} ${scopeSql}
          AND COALESCE(p.published_at, p.created_at) < ?
        ORDER BY COALESCE(p.published_at, p.created_at) DESC LIMIT 1`,
      ...scopeBinds,
      anchor,
    ),
    first<PostNeighbour>(
      env,
      `SELECT p.slug, p.title FROM posts p
        WHERE 1 = 1 ${visibility} ${scopeSql}
          AND COALESCE(p.published_at, p.created_at) > ?
        ORDER BY COALESCE(p.published_at, p.created_at) ASC LIMIT 1`,
      ...scopeBinds,
      anchor,
    ),
  ]);
  return { prev, next };
}

export async function getRelated(env: Env, post: Post, limit = 3): Promise<PostSummary[]> {
  // 专栏文章的相关文章 = 同栏其他文章；博客文章仍按标签找。
  if (post.column_id != null) {
    const rows = await all<PostRow>(
      env,
      `SELECT ${SELECT_COLUMNS_WITH_COLUMN}
         FROM posts p ${POST_JOINS}
        WHERE p.column_id = ?
          AND p.id != ?
          AND ${PUBLIC_POST_SQL}
        ORDER BY p.published_at DESC
        LIMIT ?`,
      post.column_id,
      post.id,
      limit,
    );
    const tagMap = await tagsForPosts(env, rows.map((r) => r.id));
    return rows.map((row) => toSummary(row, tagMap.get(row.id) ?? []));
  }

  const tagIds = await all<{ tag_id: number }>(
    env,
    'SELECT tag_id FROM post_tags WHERE post_id = ?',
    post.id,
  );
  if (tagIds.length === 0) return [];
  const ids = tagIds.map((t) => t.tag_id);
  const rows = await all<PostRow>(
    env,
    `SELECT DISTINCT ${SELECT_COLUMNS_WITH_COLUMN}
       FROM posts p ${POST_JOINS}
       JOIN post_tags pt ON pt.post_id = p.id
      WHERE pt.tag_id IN (${placeholders(ids.length)})
        AND p.id != ?
        AND p.column_id IS NULL
        AND ${PUBLIC_POST_SQL}
      ORDER BY p.published_at DESC
      LIMIT ?`,
    ...ids,
    post.id,
    limit,
  );
  const tagMap = await tagsForPosts(
    env,
    rows.map((r) => r.id),
  );
  return rows.map((row) => toSummary(row, tagMap.get(row.id) ?? []));
}

/** Soft-deleted posts, newest deletion first — powers the recycle bin. */
export async function listTrash(
  env: Env,
  opts: { page: number; perPage: number },
): Promise<{ items: Array<PostSummary & { deleted_at: string }>; total: number; page: number; perPage: number; totalPages: number }> {
  const offset = (opts.page - 1) * opts.perPage;
  const [countRow, rows] = await Promise.all([
    first<{ total: number }>(env, 'SELECT COUNT(*) AS total FROM posts p WHERE p.deleted_at IS NOT NULL'),
    all<PostRow & { deleted_at: string }>(
      env,
      `SELECT ${SELECT_COLUMNS_WITH_COLUMN}, p.deleted_at
         FROM posts p ${POST_JOINS}
        WHERE p.deleted_at IS NOT NULL
        ORDER BY p.deleted_at DESC, p.id DESC
        LIMIT ? OFFSET ?`,
      opts.perPage,
      offset,
    ),
  ]);
  const total = countRow?.total ?? 0;
  const tagMap = await tagsForPosts(env, rows.map((r) => r.id));
  const items = rows.map((row) => {
    const { deleted_at, ...rest } = row;
    return { ...toSummary(rest, tagMap.get(row.id) ?? []), deleted_at };
  });
  return { items, total, page: opts.page, perPage: opts.perPage, totalPages: Math.max(1, Math.ceil(total / opts.perPage)) };
}
