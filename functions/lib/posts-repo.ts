/** Reusable post queries shared by the posts, search, rss and sitemap routes. */
import type { Post, PostNeighbour, PostStatus, PostSummary, Tag } from '@shared/types';
import { all, first, placeholders } from './db';
import type { Env } from './env';

/** Public visibility rule: published (or scheduled whose time has arrived). */
export const PUBLIC_VISIBLE_SQL =
  "p.published_at IS NOT NULL AND p.published_at <= datetime('now') AND p.status IN ('published', 'scheduled')";

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
  created_at: string;
  updated_at: string;
  author_name: string | null;
  author_username: string | null;
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
  p.featured, p.views, p.author_id, p.created_at, p.updated_at,
  u.display_name AS author_name, u.username AS author_username`;

function toSummary(row: PostRow, tags: Tag[]): PostSummary {
  const { author_username, ...rest } = row;
  return { ...rest, author_name: row.author_name ?? author_username ?? null, tags };
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
}

export async function listPosts(
  env: Env,
  opts: ListPostsOptions,
): Promise<{ items: PostSummary[]; total: number; page: number; perPage: number; totalPages: number }> {
  const conditions: string[] = [];
  const binds: unknown[] = [];

  if (!opts.admin) conditions.push(`(${PUBLIC_VISIBLE_SQL})`);
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

  const countRow = await first<{ total: number }>(
    env,
    `SELECT COUNT(*) AS total FROM posts p ${where}`,
    ...binds,
  );
  const total = countRow?.total ?? 0;

  const rows = await all<PostRow>(
    env,
    `SELECT ${SELECT_COLUMNS}
       FROM posts p LEFT JOIN users u ON u.id = p.author_id
       ${where}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?`,
    ...binds,
    opts.perPage,
    offset,
  );

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
  const visibility = opts.admin ? '' : `AND ${PUBLIC_VISIBLE_SQL}`;
  const row = await first<FullRow>(
    env,
    `SELECT ${SELECT_COLUMNS}, p.content_md
       FROM posts p LEFT JOIN users u ON u.id = p.author_id
      WHERE p.slug = ? ${visibility}`,
    slug,
  );
  if (!row) return null;
  const { author_name, author_username, ...post } = row;
  void author_name;
  void author_username;
  return post as Post;
}

export async function getPostById(env: Env, id: number): Promise<Post | null> {
  const row = await first<FullRow>(
    env,
    `SELECT ${SELECT_COLUMNS}, p.content_md
       FROM posts p LEFT JOIN users u ON u.id = p.author_id
      WHERE p.id = ?`,
    id,
  );
  if (!row) return null;
  const { author_name, author_username, ...post } = row;
  void author_name;
  void author_username;
  return post as Post;
}

export async function getNeighbours(
  env: Env,
  current: Post,
  admin = false,
): Promise<{ prev: PostNeighbour | null; next: PostNeighbour | null }> {
  const visibility = admin ? '' : `AND ${PUBLIC_VISIBLE_SQL}`;
  const anchor = current.published_at ?? current.created_at;
  const [prev, next] = await Promise.all([
    first<PostNeighbour>(
      env,
      `SELECT p.slug, p.title FROM posts p
        WHERE 1 = 1 ${visibility}
          AND COALESCE(p.published_at, p.created_at) < ?
        ORDER BY COALESCE(p.published_at, p.created_at) DESC LIMIT 1`,
      anchor,
    ),
    first<PostNeighbour>(
      env,
      `SELECT p.slug, p.title FROM posts p
        WHERE 1 = 1 ${visibility}
          AND COALESCE(p.published_at, p.created_at) > ?
        ORDER BY COALESCE(p.published_at, p.created_at) ASC LIMIT 1`,
      anchor,
    ),
  ]);
  return { prev, next };
}

export async function getRelated(env: Env, post: Post, limit = 3): Promise<PostSummary[]> {
  const tagIds = await all<{ tag_id: number }>(
    env,
    'SELECT tag_id FROM post_tags WHERE post_id = ?',
    post.id,
  );
  if (tagIds.length === 0) return [];
  const ids = tagIds.map((t) => t.tag_id);
  const rows = await all<PostRow>(
    env,
    `SELECT DISTINCT ${SELECT_COLUMNS}
       FROM posts p
       LEFT JOIN users u ON u.id = p.author_id
       JOIN post_tags pt ON pt.post_id = p.id
      WHERE pt.tag_id IN (${placeholders(ids.length)})
        AND p.id != ?
        AND ${PUBLIC_VISIBLE_SQL}
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
