import { Hono } from 'hono';
import { z } from 'zod';
import type { Comment, CommentStatus } from '@shared/types';
import { requireAuth } from '../lib/auth';
import { hashIp } from '../lib/crypto';
import { all, first, run } from '../lib/db';
import type { AppEnv, Env } from '../lib/env';
import { AppError } from '../lib/errors';
import { hit } from '../lib/rate-limit';
import { created, ok } from '../lib/response';
import { looksLikeSpam } from '../lib/sanitize';
import { getSettings } from '../lib/settings';
import { paginationSchema, parseJson } from '../lib/validate';

export const commentRoutes = new Hono<AppEnv>();

type FlatComment = Omit<Comment, 'replies'>;

/** Assemble the flat comment table into a reply tree. */
function buildTree(rows: FlatComment[]): Comment[] {
  const byId = new Map<number, Comment>();
  for (const row of rows) byId.set(row.id, { ...row, replies: [] });
  const roots: Comment[] = [];
  for (const row of rows) {
    const node = byId.get(row.id);
    if (!node) continue;
    const parent = row.parent_id ? byId.get(row.parent_id) : undefined;
    if (parent) {
      (parent.replies ??= []).push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

/** Public: approved comments for a post, threaded. */
commentRoutes.get('/post/:slug', async (c) => {
  const slug = c.req.param('slug');
  const post = await first<{ id: number }>(
    c.env,
    `SELECT id FROM posts
      WHERE slug = ?
        AND published_at IS NOT NULL AND published_at <= datetime('now')
        AND status IN ('published', 'scheduled')`,
    slug,
  );
  if (!post) throw AppError.notFound('文章不存在');

  const rows = await all<FlatComment>(
    c.env,
    `SELECT id, post_id, parent_id, author, content, status, created_at
       FROM comments
      WHERE post_id = ? AND status = 'approved'
      ORDER BY created_at ASC`,
    post.id,
  );
  c.header('Cache-Control', 'public, max-age=0, s-maxage=30');
  return ok(c, buildTree(rows));
});

const createSchema = z.object({
  postSlug: z.string().trim().min(1).max(200),
  parentId: z.number().int().positive().nullable().optional(),
  author: z.string().trim().min(1, '请填写昵称').max(60),
  email: z.union([z.literal(''), z.string().trim().email('邮箱格式不正确').max(254)]).optional(),
  website: z.union([z.literal(''), z.string().trim().url('网址格式不正确').max(200)]).optional(),
  content: z.string().trim().min(2, '评论内容太短').max(2000, '评论内容过长'),
  // Honeypot: hidden field. Bots fill it; we accept the request but persist
  // nothing (see handler). It must NOT be validated to empty here, or the bot
  // would receive a 422 that reveals the trap.
  _gotcha: z.string().max(500).optional(),
});

/** Public: submit a comment (moderated + rate limited + honeypot). */
commentRoutes.post('/', async (c) => {
  const body = await parseJson(c, createSchema);
  const settings = await getSettings(c.env);

  if (!settings.features.comments) throw AppError.forbidden('评论功能已关闭');
  if (!settings.comments.allowGuests && !c.get('user')) {
    throw AppError.forbidden('登录后才能评论');
  }

  // Honeypot tripped: pretend success without persisting anything.
  if (body._gotcha && body._gotcha.length > 0) {
    return created(c, { id: 0, status: 'pending', message: '评论已提交，等待审核。' });
  }

  if (body.content.length < settings.comments.minLength) {
    throw AppError.badRequest(`评论至少 ${settings.comments.minLength} 个字符`);
  }
  if (body.content.length > settings.comments.maxLength) {
    throw AppError.badRequest(`评论不得超过 ${settings.comments.maxLength} 个字符`);
  }

  const post = await first<{ id: number }>(
    c.env,
    `SELECT id FROM posts
      WHERE slug = ?
        AND published_at IS NOT NULL AND published_at <= datetime('now')
        AND status IN ('published', 'scheduled')`,
    body.postSlug,
  );
  if (!post) throw AppError.notFound('文章不存在');

  const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown';
  const ipHash = await hashIp(ip, c.env.JWT_SECRET);

  const limit = await hit(c.env, `comment:${ipHash}`, 5, Math.max(10, settings.comments.rateLimitSeconds));
  if (!limit.allowed) throw AppError.rateLimited('评论过于频繁，请稍后再试');

  // Guard against replying to a comment from a different post.
  if (body.parentId) {
    const parent = await first<{ post_id: number }>(
      c.env,
      'SELECT post_id FROM comments WHERE id = ?',
      body.parentId,
    );
    if (!parent || parent.post_id !== post.id) throw AppError.badRequest('无效的回复目标');
  }

  const status: CommentStatus = looksLikeSpam(body.content)
    ? 'spam'
    : settings.comments.requireModeration
      ? 'pending'
      : 'approved';

  const result = await run(
    c.env,
    `INSERT INTO comments (post_id, parent_id, author, email, website, content, status, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    post.id,
    body.parentId ?? null,
    body.author,
    body.email || null,
    body.website || null,
    body.content,
    status,
    ipHash,
  );

  return created(c, {
    id: Number(result.meta.last_row_id),
    status,
    message: status === 'approved' ? '评论已发布。' : '评论已提交，等待审核。',
  });
});

/* --------------------------------------------------------- admin routes */

const adminListQuery = paginationSchema.extend({
  status: z.enum(['pending', 'approved', 'rejected', 'spam']).optional(),
  postId: z.coerce.number().int().positive().optional(),
  q: z.string().trim().max(100).optional(),
});

commentRoutes.get('/', requireAuth, async (c) => {
  const parsed = adminListQuery.safeParse(c.req.query());
  if (!parsed.success) throw AppError.validation('查询参数校验失败', parsed.error.flatten());
  const { page, perPage, status, postId, q } = parsed.data;
  c.header('Cache-Control', 'no-store');

  const conditions: string[] = [];
  const binds: unknown[] = [];
  if (status) {
    conditions.push('c.status = ?');
    binds.push(status);
  }
  if (postId) {
    conditions.push('c.post_id = ?');
    binds.push(postId);
  }
  if (q) {
    conditions.push('(c.author LIKE ? OR c.content LIKE ?)');
    binds.push(`%${q}%`, `%${q}%`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const totalRow = await first<{ total: number }>(
    c.env,
    `SELECT COUNT(*) AS total FROM comments c ${where}`,
    ...binds,
  );
  const total = totalRow?.total ?? 0;

  const rows = await all<
    FlatComment & { post_title: string; post_slug: string }
  >(
    c.env,
    `SELECT c.id, c.post_id, c.parent_id, c.author, c.content, c.status, c.created_at,
            p.title AS post_title, p.slug AS post_slug
       FROM comments c JOIN posts p ON p.id = c.post_id
       ${where}
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?`,
    ...binds,
    perPage,
    (page - 1) * perPage,
  );

  return ok(c, rows, {
    page,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  });
});

const patchSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'spam']),
});

commentRoutes.patch('/:id', requireAuth, async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id)) throw AppError.badRequest('非法评论 ID');
  const body = await parseJson(c, patchSchema);
  const result = await run(c.env, 'UPDATE comments SET status = ? WHERE id = ?', body.status, id);
  if (result.meta.changes === 0) throw AppError.notFound('评论不存在');
  return ok(c, { id, status: body.status });
});

commentRoutes.delete('/:id', requireAuth, async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id)) throw AppError.badRequest('非法评论 ID');
  // Delete children explicitly (works without FK cascade enforcement).
  await deleteCommentTree(c.env, id);
  return ok(c, { deleted: true });
});

async function deleteCommentTree(env: Env, id: number): Promise<void> {
  const children = await all<{ id: number }>(env, 'SELECT id FROM comments WHERE parent_id = ?', id);
  for (const child of children) await deleteCommentTree(env, child.id);
  await run(env, 'DELETE FROM comments WHERE id = ?', id);
}
