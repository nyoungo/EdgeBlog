import { Hono } from 'hono';
import { z } from 'zod';
import { all, first, isUniqueViolation, run } from '../lib/db';
import type { AppEnv } from '../lib/env';
import { AppError } from '../lib/errors';
import { ok } from '../lib/response';
import { slugify } from '../lib/sanitize';
import { parseJson } from '../lib/validate';
import { requireAuth } from '../lib/auth';
import type { Tag } from '@shared/types';
import { PUBLIC_VISIBLE_SQL } from '../lib/posts-repo';
import { recordAudit } from '../lib/audit';

export const tagRoutes = new Hono<AppEnv>();

interface TagWithCount extends Tag {
  post_count: number;
}

tagRoutes.get('/', async (c) => {
  // Admin management needs empty tags too; the public list hides count = 0.
  const includeEmpty = Boolean(c.get('user')) && c.req.query('all') === '1';
  const rows = await all<TagWithCount>(
    c.env,
    `SELECT t.id, t.name, t.slug, COUNT(p.id) AS post_count
       FROM tags t
       LEFT JOIN post_tags pt ON pt.tag_id = t.id
       LEFT JOIN posts p ON p.id = pt.post_id
            AND p.column_id IS NULL AND (${PUBLIC_VISIBLE_SQL})
      GROUP BY t.id, t.name, t.slug
      ${includeEmpty ? '' : 'HAVING post_count > 0'}
      ORDER BY post_count DESC, t.name ASC`,
  );
  c.header('Cache-Control', includeEmpty ? 'no-store' : 'public, max-age=60, s-maxage=300');
  return ok(c, rows);
});

const tagInput = z.object({
  name: z.string().trim().min(1, '标签名不能为空').max(50),
  slug: z.string().trim().max(60).optional(),
});

tagRoutes.post('/', requireAuth, async (c) => {
  const body = await parseJson(c, tagInput);
  const slug = body.slug ? slugify(body.slug) : slugify(body.name);
  try {
    const result = await run(
      c.env,
      'INSERT INTO tags (name, slug) VALUES (?, ?)',
      body.name,
      slug,
    );
    const row = await first<Tag>(
      c.env,
      'SELECT id, name, slug FROM tags WHERE id = ?',
      result.meta.last_row_id,
    );
    await recordAudit(c.env, c.get('user'), 'tag.create', 'tag', Number(result.meta.last_row_id), {
      name: body.name,
    });
    return c.json({ ok: true, data: row }, 201);
  } catch (err) {
    if (isUniqueViolation(err)) throw AppError.conflict('同名标签或 slug 已存在');
    throw err;
  }
});

tagRoutes.put('/:id', requireAuth, async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id)) throw AppError.badRequest('非法标签 ID');
  const body = await parseJson(c, tagInput);
  const slug = body.slug ? slugify(body.slug) : slugify(body.name);
  try {
    const result = await run(
      c.env,
      'UPDATE tags SET name = ?, slug = ? WHERE id = ?',
      body.name,
      slug,
      id,
    );
    if (result.meta.changes === 0) throw AppError.notFound('标签不存在');
  } catch (err) {
    if (isUniqueViolation(err)) throw AppError.conflict('同名标签或 slug 已存在');
    throw err;
  }
  const row = await first<Tag>(c.env, 'SELECT id, name, slug FROM tags WHERE id = ?', id);
  await recordAudit(c.env, c.get('user'), 'tag.update', 'tag', id, { name: body.name });
  return ok(c, row);
});

tagRoutes.delete('/:id', requireAuth, async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id)) throw AppError.badRequest('非法标签 ID');
  // Delete the join rows first so this is deterministic regardless of whether
  // D1 has foreign-key enforcement enabled for the connection.
  await run(c.env, 'DELETE FROM post_tags WHERE tag_id = ?', id);
  const result = await run(c.env, 'DELETE FROM tags WHERE id = ?', id);
  if (result.meta.changes === 0) throw AppError.notFound('标签不存在');
  await recordAudit(c.env, c.get('user'), 'tag.delete', 'tag', id);
  return ok(c, { deleted: true });
});
