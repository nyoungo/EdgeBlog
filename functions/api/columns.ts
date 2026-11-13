/**
 * 专栏接口。
 *
 *   GET    /api/columns            公开：可见专栏 + 卡片数据（封面/简介/最新 5 篇）
 *   GET    /api/columns/sidebar    公开：侧栏绑定的专栏 + 每栏最新 3 篇
 *   GET    /api/columns/admin      后台：全部专栏（含隐藏）
 *   GET    /api/columns/:slug      公开：单个专栏
 *   POST   /api/columns            后台：新建
 *   PUT    /api/columns/:id        后台：更新
 *   DELETE /api/columns/:id        后台：删除（专栏非空时拒绝）
 *
 * 注意：`/sidebar`、`/admin` 必须注册在 `/:slug` 之前，否则会被当成 slug。
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { ColumnSummary } from '@shared/types';
import { requireAuth } from '../lib/auth';
import { first, run, isUniqueViolation } from '../lib/db';
import type { AppEnv } from '../lib/env';
import { AppError } from '../lib/errors';
import { ok, created } from '../lib/response';
import { recordAudit } from '../lib/audit';
import { parseJson } from '../lib/validate';
import {
  countPostsInColumn,
  getColumnById,
  getColumnBySlug,
  listColumns,
  listSidebarColumns,
  uniqueColumnSlug,
} from '../lib/columns-repo';

export const columnRoutes = new Hono<AppEnv>();

const columnBody = z.object({
  name: z.string().trim().min(1, '专栏名称不能为空').max(80),
  slug: z.string().trim().max(120).optional(),
  description: z.string().trim().max(500).optional(),
  coverUrl: z.string().trim().max(1000).nullable().optional(),
  sortOrder: z.number().int().min(-9999).max(9999).optional(),
  visible: z.boolean().optional(),
  showInSidebar: z.boolean().optional(),
});

const columnUpdateBody = columnBody.partial();

/* --------------------------------------------------------------- 公开读取 */

columnRoutes.get('/', async (c) => {
  c.header('Cache-Control', 'public, max-age=0, s-maxage=60');
  return ok(c, (await listColumns(c.env)) as ColumnSummary[]);
});

columnRoutes.get('/sidebar', async (c) => {
  c.header('Cache-Control', 'public, max-age=0, s-maxage=60');
  return ok(c, await listSidebarColumns(c.env));
});

/* --------------------------------------------------------------- 后台读取 */

columnRoutes.get('/admin', requireAuth, async (c) => {
  c.header('Cache-Control', 'no-store');
  // 后台统计包含草稿：删除拦截也按全部文章算，否则会出现「显示 0 篇却删不掉」。
  return ok(c, await listColumns(c.env, { includeHidden: true, countUnpublished: true }));
});

columnRoutes.get('/:slug', async (c) => {
  const column = await getColumnBySlug(c.env, c.req.param('slug'));
  if (!column) throw AppError.notFound('专栏不存在');
  c.header('Cache-Control', 'public, max-age=0, s-maxage=60');
  return ok(c, column);
});

/* --------------------------------------------------------------- 后台写入 */

columnRoutes.post('/', requireAuth, async (c) => {
  const body = await parseJson(c, columnBody);
  const slug = body.slug
    ? await uniqueColumnSlug(c.env, body.slug, null)
    : await uniqueColumnSlug(c.env, body.name, null);

  try {
    const result = await run(
      c.env,
      `INSERT INTO columns (slug, name, description, cover_url, sort_order, visible, show_in_sidebar)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      slug,
      body.name,
      body.description ?? '',
      body.coverUrl ?? null,
      body.sortOrder ?? 0,
      body.visible === false ? 0 : 1,
      body.showInSidebar ? 1 : 0,
    );
    const id = Number(result.meta.last_row_id);
    await recordAudit(c.env, c.get('user'), 'column.create', 'column', id, { name: body.name });
    return created(c, await getColumnById(c.env, id, { includeHidden: true }));
  } catch (err) {
    if (isUniqueViolation(err)) throw AppError.conflict('专栏 slug 已存在');
    throw err;
  }
});

columnRoutes.put('/:id', requireAuth, async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id)) throw AppError.badRequest('非法专栏 ID');

  const existing = await getColumnById(c.env, id, { includeHidden: true });
  if (!existing) throw AppError.notFound('专栏不存在');

  const body = await parseJson(c, columnUpdateBody);
  const slug =
    body.slug === undefined
      ? existing.slug
      : await uniqueColumnSlug(c.env, body.slug || body.name || existing.name, id);

  try {
    await run(
      c.env,
      `UPDATE columns SET
          slug = ?, name = ?, description = ?, cover_url = ?,
          sort_order = ?, visible = ?, show_in_sidebar = ?, updated_at = datetime('now')
        WHERE id = ?`,
      slug,
      body.name ?? existing.name,
      body.description !== undefined ? body.description : existing.description,
      body.coverUrl !== undefined ? body.coverUrl : existing.cover_url,
      body.sortOrder !== undefined ? body.sortOrder : existing.sort_order,
      body.visible === undefined ? existing.visible : body.visible ? 1 : 0,
      body.showInSidebar === undefined ? existing.show_in_sidebar : body.showInSidebar ? 1 : 0,
      id,
    );
  } catch (err) {
    if (isUniqueViolation(err)) throw AppError.conflict('专栏 slug 已存在');
    throw err;
  }

  await recordAudit(c.env, c.get('user'), 'column.update', 'column', id, {
    name: body.name ?? existing.name,
  });
  return ok(c, await getColumnById(c.env, id, { includeHidden: true }));
});

columnRoutes.delete('/:id', requireAuth, async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id)) throw AppError.badRequest('非法专栏 ID');

  const existing = await first<{ id: number; name: string }>(
    c.env,
    'SELECT id, name FROM columns WHERE id = ?',
    id,
  );
  if (!existing) throw AppError.notFound('专栏不存在');

  // 非空专栏直接拒绝：静默把文章放回博客会让两类内容混在一起，
  // 违背「专栏与博客不混合」的产品约束。
  const count = await countPostsInColumn(c.env, id);
  if (count > 0) {
    throw AppError.conflict(`该专栏还有 ${count} 篇文章，请先迁移或删除这些文章`);
  }

  await run(c.env, 'DELETE FROM columns WHERE id = ?', id);
  await recordAudit(c.env, c.get('user'), 'column.delete', 'column', id, { name: existing.name });
  return ok(c, { deleted: true });
});
