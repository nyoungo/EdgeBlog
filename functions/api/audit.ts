import { Hono } from 'hono';
import { z } from 'zod';
import type { AuditLogEntry } from '@shared/types';
import { requireAdmin } from '../lib/auth';
import { all, first } from '../lib/db';
import type { AppEnv } from '../lib/env';
import { AppError } from '../lib/errors';
import { ok } from '../lib/response';
import { paginationSchema } from '../lib/validate';

export const auditRoutes = new Hono<AppEnv>();

auditRoutes.use('*', requireAdmin);

const auditQuery = paginationSchema.extend({
  action: z.string().trim().max(60).optional(),
});

auditRoutes.get('/', async (c) => {
  const parsed = auditQuery.safeParse(c.req.query());
  if (!parsed.success) throw AppError.validation('查询参数校验失败', parsed.error.flatten());
  const { page, perPage, action } = parsed.data;
  c.header('Cache-Control', 'no-store');

  const where = action ? 'WHERE action LIKE ?' : '';
  const binds: unknown[] = action ? [`${action}%`] : [];

  const totalRow = await first<{ total: number }>(
    c.env,
    `SELECT COUNT(*) AS total FROM audit_log ${where}`,
    ...binds,
  );
  const total = totalRow?.total ?? 0;

  const rows = await all<AuditLogEntry>(
    c.env,
    `SELECT id, actor_id, actor_name, action, target_type, target_id, detail, created_at
       FROM audit_log ${where}
      ORDER BY created_at DESC, id DESC
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