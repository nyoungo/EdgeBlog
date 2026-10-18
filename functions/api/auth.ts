import { Hono } from 'hono';
import { z } from 'zod';
import {
  createSession,
  destroySession,
  findUserWithHash,
  requireAuth,
} from '../lib/auth';
import { hashIp, hashPassword, verifyPassword } from '../lib/crypto';
import { run } from '../lib/db';
import type { AppEnv } from '../lib/env';
import { AppError } from '../lib/errors';
import { clear, hit } from '../lib/rate-limit';
import { ok } from '../lib/response';
import { parseJson } from '../lib/validate';

export const authRoutes = new Hono<AppEnv>();

/**
 * A syntactically valid hash used to equalise timing when a username does not
 * exist, preventing trivial username enumeration via response latency.
 */
const DUMMY_HASH =
  'pbkdf2$sha256$100000$7JLZTZlF8PGGrR8OIj10MQ==$7h5ZZqKw78X74klSabwLqz5Qt/OzbepItyy4Ji8GKOI=';

const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(200),
});

function clientIp(c: { req: { header: (n: string) => string | undefined } }): string {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown';
}

async function recordAttempt(
  env: AppEnv['Bindings'],
  key: string,
  success: boolean,
): Promise<void> {
  try {
    await run(env, 'INSERT INTO login_attempts (key, success) VALUES (?, ?)', key, success ? 1 : 0);
  } catch {
    /* audit ledger must never block login */
  }
}

authRoutes.post('/login', async (c) => {
  const body = await parseJson(c, loginSchema);
  const ipHash = await hashIp(clientIp(c), c.env.JWT_SECRET);

  const limit = await hit(c.env, `login:${ipHash}`, 10, 600);
  if (!limit.allowed) {
    await recordAttempt(c.env, `ip:${ipHash}`, false);
    throw AppError.rateLimited('登录尝试过于频繁，请 10 分钟后再试');
  }

  const user = await findUserWithHash(c.env, body.username);
  const valid = await verifyPassword(body.password, user?.password_hash ?? DUMMY_HASH);

  if (!user || !valid) {
    await recordAttempt(c.env, `ip:${ipHash}`, false);
    throw AppError.unauthorized('用户名或密码错误');
  }

  await createSession(c, { id: user.id, username: user.username, role: user.role });
  await clear(c.env, `login:${ipHash}`);
  await recordAttempt(c.env, `ip:${ipHash}`, true);

  return ok(c, {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
  });
});

authRoutes.post('/logout', (c) => {
  destroySession(c);
  return ok(c, { loggedOut: true });
});

authRoutes.get('/me', (c) => {
  c.header('Cache-Control', 'no-store');
  return ok(c, { user: c.get('user') ?? null });
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z
    .string()
    .min(8, '新密码至少 8 位')
    .max(200)
    .regex(/[A-Za-z]/, '新密码需包含字母')
    .regex(/[0-9]/, '新密码需包含数字'),
});

authRoutes.post('/password', requireAuth, async (c) => {
  const user = c.get('user');
  if (!user) throw AppError.unauthorized();
  const body = await parseJson(c, passwordSchema);

  const row = await findUserWithHash(c.env, user.username);
  if (!row || !(await verifyPassword(body.currentPassword, row.password_hash))) {
    throw AppError.badRequest('当前密码不正确');
  }
  if (await verifyPassword(body.newPassword, row.password_hash)) {
    throw AppError.badRequest('新密码不能与当前密码相同');
  }

  const hash = await hashPassword(body.newPassword);
  await run(c.env, 'UPDATE users SET password_hash = ? WHERE id = ?', hash, user.id);
  // Invalidate all existing sessions for this user by rotating forward.
  await createSession(c, user);
  return ok(c, { changed: true });
});
