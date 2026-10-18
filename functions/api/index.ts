import { Hono } from 'hono';
import { attachUser } from '../lib/auth';
import type { AppEnv } from '../lib/env';
import { isAppError } from '../lib/errors';
import { corsMiddleware, csrfGuard, requestId, securityHeaders } from '../lib/middleware';
import { fail } from '../lib/response';
import { authRoutes } from './auth';
import { aiRoutes } from './ai';
import { commentRoutes } from './comments';
import { mediaRoutes } from './media';
import { postRoutes } from './posts';
import { searchRoutes } from './search';
import { settingRoutes } from './settings';
import { statsRoutes } from './stats';
import { tagRoutes } from './tags';

/**
 * The API is mounted at /api and shares one middleware pipeline:
 *   requestId -> security headers -> CORS -> CSRF -> attachUser
 * `attachUser` runs on every request so public routes can opportunistically
 * show admin-only fields (e.g. drafts) without a second round trip.
 */
export const api = new Hono<AppEnv>().basePath('/api');

api.use('*', requestId);
api.use('*', securityHeaders);
api.use('*', corsMiddleware);
api.use('*', csrfGuard);
api.use('*', attachUser);

api.onError((err, c) => {
  if (isAppError(err)) {
    return fail(c, err.code, err.message, err.status, err.details);
  }
  console.error('[api] unhandled error', err);
  return fail(c, 'INTERNAL', '服务器内部错误', 500);
});

api.notFound((c) => fail(c, 'NOT_FOUND', '接口不存在', 404));

api.get('/health', (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, data: { status: 'ok', ts: Date.now() } });
});

api.route('/auth', authRoutes);
api.route('/posts', postRoutes);
api.route('/tags', tagRoutes);
api.route('/comments', commentRoutes);
api.route('/settings', settingRoutes);
api.route('/media', mediaRoutes);
api.route('/search', searchRoutes);
api.route('/stats', statsRoutes);
api.route('/ai', aiRoutes);
