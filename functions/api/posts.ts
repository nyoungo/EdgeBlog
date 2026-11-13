import { Hono } from 'hono';
import { z } from 'zod';
import type { PostDetail, Tag } from '@shared/types';
import { requireAuth } from '../lib/auth';
import { hashIp } from '../lib/crypto';
import { first, run } from '../lib/db';
import type { AppEnv, Env } from '../lib/env';
import { AppError } from '../lib/errors';
import {
  getNeighbours,
  getPostById,
  getPostBySlug,
  getRelated,
  listArchive,
  listPosts,
  listTrash,
  tagsForPosts,
  type ListPostsOptions,
} from '../lib/posts-repo';
import { created, ok } from '../lib/response';
import { PUBLIC_POST_SQL } from '../lib/post-scope';
import { deriveExcerpt, countWords } from '../lib/sanitize';
import { getSettings } from '../lib/settings';
import { parseJson } from '../lib/validate';
import { nowSql } from '../lib/datetime';
import { recordAudit } from '../lib/audit';
import {
  resolvePublishedAt,
  resolveTagIds,
  setPostTags,
  uniqueSlug,
} from '../lib/posts-write';

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
  /** 归属专栏：null/省略 = 博客，数字 = 该专栏。 */
  columnId: z.number().int().positive().nullable().optional(),
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
  /** 专栏 slug：公开列表用它过滤某一栏，省略则只看博客。 */
  column: z.string().trim().max(120).optional(),
  /** `all` 让全站搜索同时返回博客与专栏文章。 */
  scope: z.enum(['blog', 'all']).optional(),
});

const adminListQuery = listQuery.extend({
  status: statusEnum.optional(),
  /** 归属筛选：省略 = 全部，0 = 仅博客，正数 = 该专栏。 */
  columnId: z.coerce.number().int().min(0).optional(),
});

/* --------------------------------------------------------------- helpers */

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
    // 公开列表：默认只看博客；指定专栏 slug 则只看该栏；scope=all 供全站搜索。
    ...(admin
      ? { columnId: data.columnId }
      : data.column
        ? { scope: 'column' as const, columnSlug: data.column }
        : { scope: data.scope === 'all' ? ('all' as const) : ('blog' as const) }),
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

/** 校验归属专栏存在且可见性无关（后台可发到隐藏专栏）。 */
async function resolveColumnId(env: Env, columnId: number | null | undefined): Promise<number | null> {
  if (columnId == null) return null;
  const row = await first<{ id: number }>(env, 'SELECT id FROM columns WHERE id = ?', columnId);
  if (!row) throw AppError.badRequest('指定的专栏不存在');
  return row.id;
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

// Lightweight full listing for the archive page / clients that need every
// year at once. Registered before '/:slug' so it is not treated as a slug.
postRoutes.get('/archive', async (c) => {
  c.header('Cache-Control', 'public, max-age=0, s-maxage=60');
  return ok(c, await listArchive(c.env));
});

// Recycle bin: soft-deleted posts. Admin only, never cached.
postRoutes.get('/trash', requireAuth, async (c) => {
  c.header('Cache-Control', 'no-store');
  const page = Math.max(1, Number.parseInt(c.req.query('page') ?? '1', 10) || 1);
  const perPage = Math.min(50, Math.max(1, Number.parseInt(c.req.query('perPage') ?? '20', 10) || 20));
  const result = await listTrash(c.env, { page, perPage });
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
  const columnId = await resolveColumnId(c.env, body.columnId);

  const result = await run(
    c.env,
    `INSERT INTO posts
       (slug, title, excerpt, content_md, cover_url, status, published_at,
        meta_title, meta_description, og_image, word_count, featured, author_id, column_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    columnId,
  );

  const id = Number(result.meta.last_row_id);
  // 专栏文章不参与标签体系（标签只服务博客内容），避免标签计数与筛选被污染。
  if (columnId == null && body.tags) {
    await setPostTags(c.env, id, await resolveTagIds(c.env, body.tags));
  }

  await recordAudit(c.env, user, 'post.create', 'post', id, {
    title: body.title,
    status: body.status,
    columnId,
  });

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
  const columnId =
    body.columnId === undefined ? existing.column_id : await resolveColumnId(c.env, body.columnId);

  await run(
    c.env,
    `UPDATE posts SET
        slug = ?, title = ?, excerpt = ?, content_md = ?, cover_url = ?, status = ?,
        published_at = ?, meta_title = ?, meta_description = ?, og_image = ?,
        word_count = ?, featured = ?, column_id = ?, updated_at = datetime('now')
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
    columnId,
    id,
  );

  // 从博客移到专栏时清空标签：专栏文章不进标签体系，残留关联会让标签计数虚高。
  if (columnId == null && body.tags) {
    await setPostTags(c.env, id, await resolveTagIds(c.env, body.tags));
  } else if (columnId != null && existing.column_id == null) {
    await run(c.env, 'DELETE FROM post_tags WHERE post_id = ?', id);
  }

  const actor = c.get('user');
  await recordAudit(c.env, actor, 'post.update', 'post', id, {
    title: body.title ?? existing.title,
    status,
    columnId,
  });

  return ok(c, await getPostById(c.env, id));
});

postRoutes.delete('/:id', requireAuth, async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id)) throw AppError.badRequest('非法文章 ID');
  // Soft delete: the row (and its tags/views) is kept so the operator can
  // restore it from the recycle bin. Every public read filters `deleted_at`.
  const result = await run(
    c.env,
    "UPDATE posts SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL",
    id,
  );
  if (result.meta.changes === 0) throw AppError.notFound('文章不存在');
  await recordAudit(c.env, c.get('user'), 'post.trash', 'post', id);
  return ok(c, { deleted: true, trashed: true });
});

postRoutes.post('/:id/restore', requireAuth, async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id)) throw AppError.badRequest('非法文章 ID');
  const result = await run(
    c.env,
    'UPDATE posts SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL',
    id,
  );
  if (result.meta.changes === 0) throw AppError.notFound('回收站中没有这篇文章');
  await recordAudit(c.env, c.get('user'), 'post.restore', 'post', id);
  return ok(c, await getPostById(c.env, id));
});

postRoutes.delete('/:id/purge', requireAuth, async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id)) throw AppError.badRequest('非法文章 ID');
  const existing = await first<{ id: number; deleted_at: string | null }>(
    c.env,
    'SELECT id, deleted_at FROM posts WHERE id = ?',
    id,
  );
  if (!existing) throw AppError.notFound('文章不存在');
  // Only ever purge something already in the trash: a stray DELETE call must
  // not be able to destroy a live article outright.
  if (!existing.deleted_at) throw AppError.badRequest('只能彻底删除回收站中的文章');
  await run(c.env, 'DELETE FROM post_tags WHERE post_id = ?', id);
  await run(c.env, 'DELETE FROM posts WHERE id = ?', id);
  await recordAudit(c.env, c.get('user'), 'post.purge', 'post', id);
  return ok(c, { deleted: true, purged: true });
});

postRoutes.post('/:slug/view', async (c) => {
  const settings = await getSettings(c.env);
  const slug = c.req.param('slug');
  // 隐藏专栏里的文章对外等于不存在，浏览计数也不该继续增长。
  const post = await first<{ id: number; views: number }>(
    c.env,
    `SELECT p.id, p.views FROM posts p WHERE p.slug = ? AND (${PUBLIC_POST_SQL})`,
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

  // 归属专栏：后台预览时隐藏专栏也要能显示名称。
  const column =
    post.column_id == null
      ? null
      : await first<{ id: number; slug: string; name: string }>(
          c.env,
          admin
            ? 'SELECT id, slug, name FROM columns WHERE id = ?'
            : 'SELECT id, slug, name FROM columns WHERE id = ? AND visible = 1',
          post.column_id,
        );

  const detail: PostDetail = {
    ...post,
    tags,
    author_name: author,
    column,
    prev: neighbours.prev,
    next: neighbours.next,
    related,
  };
  c.header('Cache-Control', admin ? 'no-store' : 'public, max-age=0, s-maxage=60');
  return ok(c, detail as PostDetail);
});
