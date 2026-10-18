import { Hono } from 'hono';
import { z } from 'zod';
import type { PostDetail, Tag } from '@shared/types';
import { requireAuth } from '../lib/auth';
import { hashIp } from '../lib/crypto';
import { first, run, batch } from '../lib/db';
import type { AppEnv, Env } from '../lib/env';
import { AppError } from '../lib/errors';
import {
  getNeighbours,
  getPostById,
  getPostBySlug,
  getRelated,
  listPosts,
  tagsForPosts,
  type ListPostsOptions,
} from '../lib/posts-repo';
import { created, ok } from '../lib/response';
import { deriveExcerpt, countWords, slugify } from '../lib/sanitize';
import { getSettings } from '../lib/settings';
import { parseJson } from '../lib/validate';
import { nowSql, toSqlDateTime } from '../lib/datetime';

export const postRoutes = new Hono<AppEnv>();

/* --------------------------------------------------------------- schemas */

const statusEnum = z.enum(['draft', 'published', 'scheduled']);

const postBody = z.object({
  title: z.string().trim().min(1, '标题不能为空').max(200),
  slug: z.string().trim().max(120).optional(),
  excerpt: z.string().trim().max(500).optional(),
  contentMd: z.string().max(500_000).default(''),
  coverUrl: z.string().trim().max(1000).nullable().optional(),
  status: statusEnum.default('draft'),
  publishedAt: z.string().trim().max(40).nullable().optional(),
  metaTitle: z.string().trim().max(200).nullable().optional(),
  metaDescription: z.string().trim().max(400).nullable().optional(),
  ogImage: z.string().trim().max(1000).nullable().optional(),
  featured: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
});

const postUpdateBody = postBody.partial();

const listQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  perPage: z.coerce.number().int().min(1).max(50).default(10),
  tag: z.string().trim().max(60).optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(['newest', 'oldest', 'popular', 'title']).default('newest'),
  featured: z.literal('1').optional(),
});

const adminListQuery = listQuery.extend({
  status: statusEnum.optional(),
});

/* --------------------------------------------------------------- helpers */

async function uniqueSlug(env: Env, base: string, ignoreId: number | null): Promise<string> {
  const root = slugify(base) || 'post';
  let candidate = root;
  for (let i = 2; i < 200; i++) {
    const clash = await first<{ id: number }>(
      env,
      'SELECT id FROM posts WHERE slug = ? AND (? IS NULL OR id != ?) LIMIT 1',
      candidate,
      ignoreId,
      ignoreId,
    );
    if (!clash) return candidate;
    candidate = `${root}-${i}`;
  }
  return `${root}-${Date.now().toString(36)}`;
}

async function resolveTagIds(env: Env, names: string[]): Promise<number[]> {
  const ids = new Set<number>();
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const slug = slugify(name);
    const existing = await first<{ id: number }>(
      env,
      'SELECT id FROM tags WHERE name = ? OR slug = ? LIMIT 1',
      name,
      slug,
    );
    if (existing) {
      ids.add(existing.id);
      continue;
    }
    try {
      const res = await run(env, 'INSERT INTO tags (name, slug) VALUES (?, ?)', name, slug);
      ids.add(Number(res.meta.last_row_id));
    } catch {
      const row = await first<{ id: number }>(
        env,
        'SELECT id FROM tags WHERE name = ? OR slug = ? LIMIT 1',
        name,
        slug,
      );
      if (row) ids.add(row.id);
    }
  }
  return [...ids];
}

async function setPostTags(env: Env, postId: number, tagIds: number[]): Promise<void> {
  const statements = [env.DB.prepare('DELETE FROM post_tags WHERE post_id = ?').bind(postId)];
  for (const tagId of tagIds) {
    statements.push(
      env.DB.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)').bind(
        postId,
        tagId,
      ),
    );
  }
  await batch(env, statements);
}

/** Drafts may have no publish time; scheduled posts require a future time. */
function resolvePublishedAt(
  status: z.infer<typeof statusEnum>,
  publishedAt: string | null | undefined,
): string | null {
  if (status === 'draft') return null;
  if (status === 'scheduled') {
    if (!publishedAt) throw AppError.badRequest('定时发布必须提供发布时间');
    const value = toSqlDateTime(publishedAt);
    if (value <= nowSql()) throw AppError.badRequest('定时发布时间必须晚于当前时间');
    return value;
  }
  return publishedAt ? toSqlDateTime(publishedAt) : nowSql();
}

function buildListOptions(data: z.infer<typeof adminListQuery>, admin: boolean): ListPostsOptions {
  return {
    page: data.page,
    perPage: data.perPage,
    tag: data.tag,
    q: data.q,
    sort: data.sort,
    status: data.status,
    featured: data.featured === '1',
    admin,
  };
}

async function authorName(env: Env, authorId: number | null): Promise<string | null> {
  if (!authorId) return null;
  const row = await first<{ name: string | null }>(
    env,
    'SELECT COALESCE(display_name, username) AS name FROM users WHERE id = ?',
    authorId,
  );
  return row?.name ?? null;
}

/* ---------------------------------------------------------------- routes */

// Admin list must be registered before the '/:slug' catch so it is not shadowed.
postRoutes.get('/admin', requireAuth, async (c) => {
  const parsed = adminListQuery.safeParse(c.req.query());
  if (!parsed.success) throw AppError.validation('查询参数校验失败', parsed.error.flatten());
  c.header('Cache-Control', 'no-store');
  const result = await listPosts(c.env, buildListOptions(parsed.data, true));
  return ok(c, result.items, {
    page: result.page,
    perPage: result.perPage,
    total: result.total,
    totalPages: result.totalPages,
  });
});

postRoutes.get('/', async (c) => {
  const parsed = listQuery.safeParse(c.req.query());
  if (!parsed.success) throw AppError.validation('查询参数校验失败', parsed.error.flatten());
  const result = await listPosts(c.env, buildListOptions({ ...parsed.data }, false));
  c.header('Cache-Control', 'public, max-age=0, s-maxage=60');
  return ok(c, result.items, {
    page: result.page,
    perPage: result.perPage,
    total: result.total,
    totalPages: result.totalPages,
  });
});

postRoutes.post('/', requireAuth, async (c) => {
  const user = c.get('user');
  if (!user) throw AppError.unauthorized();
  const body = await parseJson(c, postBody);

  const slug = body.slug ? await uniqueSlug(c.env, body.slug, null) : await uniqueSlug(c.env, body.title, null);
  const words = countWords(body.contentMd);
  const excerpt = body.excerpt?.trim() || deriveExcerpt(body.contentMd);
  const publishedAt = resolvePublishedAt(body.status, body.publishedAt);

  const result = await run(
    c.env,
    `INSERT INTO posts
       (slug, title, excerpt, content_md, cover_url, status, published_at,
        meta_title, meta_description, og_image, word_count, featured, author_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    slug,
    body.title,
    excerpt,
    body.contentMd,
    body.coverUrl ?? null,
    body.status,
    publishedAt,
    body.metaTitle ?? null,
    body.metaDescription ?? null,
    body.ogImage ?? null,
    words,
    body.featured ? 1 : 0,
    user.id,
  );

  const id = Number(result.meta.last_row_id);
  if (body.tags) await setPostTags(c.env, id, await resolveTagIds(c.env, body.tags));

  const post = await getPostById(c.env, id);
  return created(c, post);
});

postRoutes.put('/:id', requireAuth, async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id)) throw AppError.badRequest('非法文章 ID');

  const existing = await getPostById(c.env, id);
  if (!existing) throw AppError.notFound('文章不存在');

  const body = await parseJson(c, postUpdateBody);

  const slug =
    body.slug === undefined ? existing.slug : await uniqueSlug(c.env, body.slug || body.title || existing.title, id);
  const contentMd = body.contentMd ?? existing.content_md;
  const words = countWords(contentMd);
  const excerpt =
    body.excerpt !== undefined
      ? body.excerpt.trim()
      : existing.excerpt || deriveExcerpt(contentMd);
  const status = body.status ?? existing.status;
  const publishedAt = resolvePublishedAt(
    status,
    body.publishedAt !== undefined ? body.publishedAt : existing.published_at,
  );

  await run(
    c.env,
    `UPDATE posts SET
        slug = ?, title = ?, excerpt = ?, content_md = ?, cover_url = ?, status = ?,
        published_at = ?, meta_title = ?, meta_description = ?, og_image = ?,
        word_count = ?, featured = ?, updated_at = datetime('now')
      WHERE id = ?`,
    slug,
    body.title ?? existing.title,
    excerpt,
    contentMd,
    body.coverUrl !== undefined ? body.coverUrl : existing.cover_url,
    status,
    publishedAt,
    body.metaTitle !== undefined ? body.metaTitle : existing.meta_title,
    body.metaDescription !== undefined ? body.metaDescription : existing.meta_description,
    body.ogImage !== undefined ? body.ogImage : existing.og_image,
    words,
    body.featured === undefined ? existing.featured : body.featured ? 1 : 0,
    id,
  );

  if (body.tags) await setPostTags(c.env, id, await resolveTagIds(c.env, body.tags));

  return ok(c, await getPostById(c.env, id));
});

postRoutes.delete('/:id', requireAuth, async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id)) throw AppError.badRequest('非法文章 ID');
  await run(c.env, 'DELETE FROM post_tags WHERE post_id = ?', id);
  const result = await run(c.env, 'DELETE FROM posts WHERE id = ?', id);
  if (result.meta.changes === 0) throw AppError.notFound('文章不存在');
  return ok(c, { deleted: true });
});

postRoutes.post('/:slug/view', async (c) => {
  const settings = await getSettings(c.env);
  const slug = c.req.param('slug');
  const post = await first<{ id: number; views: number }>(
    c.env,
    `SELECT id, views FROM posts
      WHERE slug = ?
        AND published_at IS NOT NULL AND published_at <= datetime('now')
        AND status IN ('published', 'scheduled')`,
    slug,
  );
  if (!post) throw AppError.notFound('文章不存在');
  if (!settings.features.views) return ok(c, { views: post.views, counted: false });

  const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown';
  const ipHash = await hashIp(ip, c.env.JWT_SECRET);
  const day = nowSql().slice(0, 10);
  const dedupeKey = `view:${post.id}:${ipHash}:${day}`;

  if (c.env.CACHE) {
    const seen = await c.env.CACHE.get(dedupeKey);
    if (seen) return ok(c, { views: post.views, counted: false });
    await c.env.CACHE.put(dedupeKey, '1', { expirationTtl: 60 * 60 * 24 });
  }
  await run(c.env, 'UPDATE posts SET views = views + 1 WHERE id = ?', post.id);
  return ok(c, { views: post.views + 1, counted: true });
});

postRoutes.get('/:slug', async (c) => {
  const slug = c.req.param('slug');
  const admin = Boolean(c.get('user'));
  const post = await getPostBySlug(c.env, slug, { admin });
  if (!post) throw AppError.notFound('文章不存在');

  const settings = await getSettings(c.env);
  const [tags, author, neighbours, related] = await Promise.all([
    tagsForPosts(c.env, [post.id]).then((m) => m.get(post.id) ?? ([] as Tag[])),
    authorName(c.env, post.author_id),
    settings.features.prevNext ? getNeighbours(c.env, post, admin) : Promise.resolve({ prev: null, next: null }),
    settings.features.relatedPosts ? getRelated(c.env, post, 3) : Promise.resolve([]),
  ]);

  const detail: PostDetail = {
    ...post,
    tags,
    author_name: author,
    prev: neighbours.prev,
    next: neighbours.next,
    related,
  };
  c.header('Cache-Control', admin ? 'no-store' : 'public, max-age=0, s-maxage=60');
  return ok(c, detail as PostDetail);
});
