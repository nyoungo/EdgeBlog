import { Hono } from 'hono';
import { z } from 'zod';
import {
  createSession,
  destroySession,
  findUserWithHash,
  requireAuth,
} from '../lib/auth';
import { hashIp, hashPassword, passwordNeedsRehash, verifyPassword } from '../lib/crypto';
import { run } from '../lib/db';
import type { AppEnv } from '../lib/env';
import { AppError } from '../lib/errors';
import { clear, hit } from '../lib/rate-limit';
import { ok } from '../lib/response';
import { parseJson } from '../lib/validate';
import { recordAudit } from '../lib/audit';

export const authRoutes = new Hono<AppEnv>();

/**
 * A syntactically valid hash used to equalise timing when a username does not
 * exist, preventing trivial username enumeration via response latency.
 */
const DUMMY_HASH =
  'pbkdf2$sha256$210000$e+h6ecFNC4Zx8Bj914SbRA==$d3WQJL6XKgfBJZIbhxi4qOcn3YQZAu0Z2/pr2GJy2uI=';

/**
 * Password baked into `seed/seed.sql`. It is public knowledge, so a login that
 * still uses it must be treated as an insecure deployment and flagged to the
 * operator (plaintext comparison is enough — it is not a secret).
 */
const SEED_DEFAULT_PASSWORD = 'admin12345';

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

  await createSession(c, {
    id: user.id,
    username: user.username,
    role: user.role,
    tokenVersion: user.token_version,
  });
  await clear(c.env, `login:${ipHash}`);
  await recordAttempt(c.env, `ip:${ipHash}`, true);

  // Opportunistically upgrade a legacy (cheaper) hash now that we hold the
  // plaintext. Best effort: never block a successful login on this.
  if (passwordNeedsRehash(user.password_hash)) {
    try {
      const upgraded = await hashPassword(body.password);
      await run(c.env, 'UPDATE users SET password_hash = ? WHERE id = ?', upgraded, user.id);
    } catch {
      /* keep the old hash; next login tries again */
    }
  }

  // The ledger is unbounded; drop entries older than the retention window.
  await run(
    c.env,
    "DELETE FROM login_attempts WHERE created_at < datetime('now', '-30 days')",
  ).catch(() => undefined);

  return ok(c, {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    defaultPassword: body.password === SEED_DEFAULT_PASSWORD,
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
  // Bumping token_version invalidates every previously issued JWT. The cookie
  // we set below carries the new version, so this tab stays signed in while
  // other devices have to log in again.
  const nextVersion = row.token_version + 1;
  await run(
    c.env,
    'UPDATE users SET password_hash = ?, token_version = ? WHERE id = ?',
    hash,
    nextVersion,
    user.id,
  );
  await createSession(c, { ...user, tokenVersion: nextVersion });
  await recordAudit(c.env, user, 'auth.password_change', 'user', user.id);
  return ok(c, { changed: true });
});

/**
 * Revoke every session (all devices) without changing the password. Bumps
 * `token_version`, then clears the current cookie so this browser also has to
 * log in again — which is exactly what "sign out everywhere" should do.
 */
authRoutes.post('/logout-all', requireAuth, async (c) => {
  const user = c.get('user');
  if (!user) throw AppError.unauthorized();
  await run(c.env, 'UPDATE users SET token_version = token_version + 1 WHERE id = ?', user.id);
  await recordAudit(c.env, user, 'auth.logout_all', 'user', user.id);
  destroySession(c);
  return ok(c, { loggedOut: true, allDevices: true });
});
