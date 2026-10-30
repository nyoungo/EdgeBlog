/** Session cookie management + auth middlewares. */
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { first } from './db';
import type { AppEnv, Env, SessionUser } from './env';
import { AppError } from './errors';
import { signJwt, verifyJwt } from './jwt';

type Ctx = Context<AppEnv>;

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function cookieName(env: Env): string {
  return env.SESSION_COOKIE || 'eb_session';
}

function isProduction(env: Env): boolean {
  return (env.ENVIRONMENT ?? 'production') !== 'development';
}

export async function readSessionUser(c: Ctx): Promise<SessionUser | null> {
  const token = getCookie(c, cookieName(c.env));
  if (!token) return null;
  const payload = await verifyJwt(token, c.env.JWT_SECRET);
  if (!payload) return null;
  return {
    id: payload.sub,
    username: payload.username,
    role: payload.role,
    tokenVersion: typeof payload.ver === 'number' ? payload.ver : 0,
  };
}

/**
 * True when the token's version still matches the user row. Bumping
 * `users.token_version` (password change, forced logout) invalidates every
 * previously issued token, which a stateless JWT cannot do on its own.
 */
async function isSessionCurrent(env: Env, user: SessionUser): Promise<boolean> {
  const row = await first<{ token_version: number }>(
    env,
    'SELECT token_version FROM users WHERE id = ?',
    user.id,
  );
  return !!row && row.token_version === user.tokenVersion;
}

export async function createSession(c: Ctx, user: SessionUser): Promise<void> {
  const token = await signJwt(
    { sub: user.id, username: user.username, role: user.role, ver: user.tokenVersion },
    c.env.JWT_SECRET,
    SESSION_TTL_SECONDS,
  );
  setCookie(c, cookieName(c.env), token, {
    httpOnly: true,
    secure: isProduction(c.env),
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function destroySession(c: Ctx): void {
  deleteCookie(c, cookieName(c.env), { path: '/' });
}

/**
 * Populate c.var.user when a valid session exists (never throws). Tokens from
 * before the last password change are dropped here so public routes cannot
 * treat a revoked session as logged in.
 */
export const attachUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  let user = await readSessionUser(c);
  if (user) {
    try {
      if (!(await isSessionCurrent(c.env, user))) user = null;
    } catch (err) {
      // Degrade to a guest on a transient DB failure: public pages keep
      // working, and protected routes still reject because user becomes null.
      console.error('[auth] session version check failed', err);
      user = null;
    }
  }
  c.set('user', user);
  await next();
};

/** Resolve the session, falling back to the cookie when attachUser did not run. */
async function authenticate(c: Ctx): Promise<SessionUser | null> {
  const cached = c.get('user');
  if (cached) return cached;
  const user = await readSessionUser(c);
  if (!user) return null;
  return (await isSessionCurrent(c.env, user)) ? user : null;
}

/** Require any authenticated user. */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await authenticate(c);
  if (!user) throw AppError.unauthorized();
  c.set('user', user);
  await next();
};

/** Require an admin role. */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await authenticate(c);
  if (!user) throw AppError.unauthorized();
  if (user.role !== 'admin') throw AppError.forbidden('需要管理员权限');
  c.set('user', user);
  await next();
};

/** Load a user row including the password hash (auth endpoints only). */
export async function findUserWithHash(env: Env, username: string) {
  return env.DB.prepare(
    'SELECT id, username, display_name, password_hash, role, token_version FROM users WHERE username = ?',
  )
    .bind(username)
    .first<{
      id: number;
      username: string;
      display_name: string | null;
      password_hash: string;
      role: 'admin' | 'editor';
      token_version: number;
    }>();
}
