import { Hono } from 'hono';
import { attachUser } from '../lib/auth';
import { first } from '../lib/db';
import { assertSecrets, type AppEnv } from '../lib/env';
import { isAppError, isMissingTableError } from '../lib/errors';
import { corsMiddleware, csrfGuard, requestId, securityHeaders } from '../lib/middleware';
import { fail } from '../lib/response';
import { authRoutes } from './auth';
import { aiRoutes } from './ai';
import { auditRoutes } from './audit';
import { automationRoutes } from './automation';
import { columnRoutes } from './columns';
import { commentRoutes } from './comments';
import { exportRoutes } from './export';
import { mediaRoutes } from './media';
import { postRoutes } from './posts';
import { searchRoutes } from './search';
import { settingRoutes } from './settings';
import { statsRoutes } from './stats';
import { tagRoutes } from './tags';
import { wechatRoutes } from './wechat';

/**
 * The API is mounted at /api and shares one middleware pipeline:
 *   requestId -> security headers -> CORS -> CSRF -> attachUser
 * `attachUser` runs on every request so public routes can opportunistically
 * show admin-only fields (e.g. drafts) without a second round trip.
 */
export const api = new Hono<AppEnv>().basePath('/api');

api.use('*', requestId);
api.use('*', async (c, next) => {
  // Refuse to run with a missing/weak signing key rather than issuing tokens
  // that anyone can forge.
  assertSecrets(c.env);
  await next();
});
api.use('*', securityHeaders);
api.use('*', corsMiddleware);
api.use('*', csrfGuard);
api.use('*', attachUser);

api.onError((err, c) => {
  if (isAppError(err)) {
    return fail(c, err.code, err.message, err.status, err.details);
  }
  // An empty D1 database is a setup problem, not a server bug. A generic 500
  // here is what made "D1 无法初始化" reports so hard to diagnose.
  if (isMissingTableError(err)) {
    console.error('[api] database not initialized', err);
    return fail(
      c,
      'INTERNAL',
      '数据库尚未初始化：请按 README 的「初始化远程数据库」执行 db/init.sql，或依次执行 migrations/ 下的 SQL 与 seed/seed.sql',
      500,
      { hint: 'database-not-initialized' },
    );
  }
  console.error('[api] unhandled error', err);
  return fail(c, 'INTERNAL', '服务器内部错误', 500);
});

api.notFound((c) => fail(c, 'NOT_FOUND', '接口不存在', 404));

api.get('/health', async (c) => {
  c.header('Cache-Control', 'no-store');
  // A missing `settings` table means migrations were never applied. Report it
  // here so a misconfigured deployment is visible before users hit 500s.
  let db: 'ok' | 'uninitialized' | 'error' = 'ok';
  try {
    const table = await first<{ name: string }>(
      c.env,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'settings'",
    );
    if (!table) db = 'uninitialized';
  } catch {
    db = 'error';
  }
  return c.json({
    ok: true,
    data: { status: db === 'ok' ? 'ok' : 'degraded', db, ts: Date.now() },
  });
});

api.route('/auth', authRoutes);
api.route('/posts', postRoutes);
api.route('/columns', columnRoutes);
api.route('/tags', tagRoutes);
api.route('/comments', commentRoutes);
api.route('/settings', settingRoutes);
api.route('/media', mediaRoutes);
api.route('/search', searchRoutes);
api.route('/stats', statsRoutes);
api.route('/ai', aiRoutes);
api.route('/automation', automationRoutes);
api.route('/wechat', wechatRoutes);
api.route('/audit', auditRoutes);
api.route('/export', exportRoutes);
