import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, Env } from '../functions/lib/env';
import { assertSecrets } from '../functions/lib/env';
import { attachUser, requireAdmin, requireAuth } from '../functions/lib/auth';
import { isAppError } from '../functions/lib/errors';
import { normalizeAiBaseUrl } from '../functions/lib/ai';
import { signJwt, verifyJwt } from '../functions/lib/jwt';
import { looksLikeSpam } from '../functions/lib/sanitize';
import { httpUrlSchema, isHttpUrl } from '../functions/lib/validate';

const SECRET = 'test-secret-that-is-long-enough-0123456789';

/** Minimal Env stub: the helpers under test only read ENVIRONMENT. */
function env(overrides: Partial<Env> = {}): Env {
  return { ENVIRONMENT: 'production', ...overrides } as Env;
}

/** Env stub whose users table reports a fixed token_version. */
function sessionEnv(tokenVersion: number): Env {
  return {
    JWT_SECRET: SECRET,
    DB: {
      prepare: () => ({
        bind: () => ({
          first: async () => ({ token_version: tokenVersion }),
        }),
      }),
    },
  } as unknown as Env;
}

function sessionApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError((err, c) => c.json({ error: err.message }, isAppError(err) ? err.status : 500));
  app.use('*', attachUser);
  app.get('/me', (c) => c.json({ user: c.get('user') }));
  app.get('/private', requireAuth, (c) => c.json({ user: c.get('user') }));
  app.get('/admin', requireAdmin, (c) => c.json({ user: c.get('user') }));
  return app;
}

describe('looksLikeSpam', () => {
  it('never flags ordinary prose', () => {
    expect(looksLikeSpam('hello world')).toBe(false);
    expect(looksLikeSpam('写得很好，收藏了，谢谢分享！')).toBe(false);
  });

  it('allows a comment with one or two links unless spam keywords appear', () => {
    expect(looksLikeSpam('参考 https://example.com/a')).toBe(false);
    expect(looksLikeSpam('两个链接 https://a.com https://b.com')).toBe(false);
    expect(looksLikeSpam('viagra https://a.com https://b.com')).toBe(true);
    expect(looksLikeSpam('免费领取 https://a.com https://b.com')).toBe(true);
  });

  it('flags heavy link drops', () => {
    expect(looksLikeSpam('a https://a.com https://b.com https://c.com https://d.com')).toBe(true);
  });
});

describe('httpUrl validation', () => {
  it('accepts only http(s) URLs', () => {
    expect(isHttpUrl('https://example.com/a?b=1')).toBe(true);
    expect(isHttpUrl('http://localhost:3000')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isHttpUrl('ftp://example.com')).toBe(false);
    expect(isHttpUrl('https://user:pass@example.com')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
  });

  it('rejects dangerous schemes through the zod schema', () => {
    expect(httpUrlSchema.safeParse('javascript:alert(1)').success).toBe(false);
    expect(httpUrlSchema.safeParse('data:text/html,x').success).toBe(false);
    expect(httpUrlSchema.safeParse('https://example.com').success).toBe(true);
  });
});

describe('normalizeAiBaseUrl', () => {
  it('accepts https anywhere', () => {
    expect(normalizeAiBaseUrl(env(), ' https://api.openai.com/v1 ')).toBe('https://api.openai.com/v1');
  });

  it('rejects non-http(s) schemes before the API key is attached', () => {
    expect(() => normalizeAiBaseUrl(env(), 'javascript:alert(1)')).toThrow();
    expect(() => normalizeAiBaseUrl(env(), 'file:///etc/passwd')).toThrow();
    expect(() => normalizeAiBaseUrl(env(), 'data:text/plain,x')).toThrow();
  });

  it('requires https in production but keeps loopback http for local providers', () => {
    expect(() => normalizeAiBaseUrl(env(), 'http://api.example.com/v1')).toThrow();
    expect(normalizeAiBaseUrl(env(), 'http://localhost:8787/v1')).toBe('http://localhost:8787/v1');
    expect(normalizeAiBaseUrl(env({ ENVIRONMENT: 'development' }), 'http://10.0.0.2/v1')).toBe(
      'http://10.0.0.2/v1',
    );
  });

  it('rejects embedded credentials', () => {
    expect(() => normalizeAiBaseUrl(env(), 'https://user:pass@example.com/v1')).toThrow();
  });
});

describe('assertSecrets', () => {
  it('fails fast when JWT_SECRET is missing or too short', () => {
    expect(() => assertSecrets(env())).toThrow();
    expect(() => assertSecrets(env({ JWT_SECRET: 'short' }))).toThrow();
  });

  it('accepts a long enough secret', () => {
    expect(() => assertSecrets(env({ JWT_SECRET: SECRET }))).not.toThrow();
  });
});

describe('session tokens', () => {
  const claims = { sub: 1, username: 'admin', role: 'admin' as const, ver: 7 };

  it('round-trips claims including the session version', async () => {
    const token = await signJwt(claims, SECRET, 60);
    const payload = await verifyJwt(token, SECRET);
    expect(payload).toMatchObject(claims);
  });

  it('rejects a token signed with another secret', async () => {
    const token = await signJwt(claims, SECRET, 60);
    expect(await verifyJwt(token, `${SECRET}-other`)).toBeNull();
  });

  it('rejects a tampered payload', async () => {
    const token = await signJwt(claims, SECRET, 60);
    const [header, , signature] = token.split('.');
    const tampered = btoa(JSON.stringify({ ...claims, ver: 8, iat: 1, exp: 9_999_999_999 }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(await verifyJwt(`${header}.${tampered}.${signature}`, SECRET)).toBeNull();
  });

  it('rejects expired tokens', async () => {
    const token = await signJwt(claims, SECRET, -1);
    expect(await verifyJwt(token, SECRET)).toBeNull();
  });
});

describe('session revocation', () => {
  const claims = { sub: 1, username: 'admin', role: 'admin' as const, ver: 7 };

  it('accepts a token whose version matches the user row', async () => {
    const token = await signJwt(claims, SECRET, 60);
    const res = await sessionApp().request(
      '/private',
      { headers: { cookie: `eb_session=${token}` } },
      sessionEnv(7),
    );
    expect(res.status).toBe(200);
  });

  it('treats tokens issued before a password change as logged out', async () => {
    const app = sessionApp();
    const token = await signJwt(claims, SECRET, 60);
    const headers = { cookie: `eb_session=${token}` };

    const me = await app.request('/me', { headers }, sessionEnv(8));
    expect(await me.json()).toEqual({ user: null });

    const denied = await app.request('/private', { headers }, sessionEnv(8));
    expect(denied.status).toBe(401);
  });

  it('lets only admin sessions through requireAdmin', async () => {
    const app = sessionApp();
    const editorToken = await signJwt(
      { sub: 2, username: 'editor', role: 'editor', ver: 0 },
      SECRET,
      60,
    );
    const editor = await app.request(
      '/admin',
      { headers: { cookie: `eb_session=${editorToken}` } },
      sessionEnv(0),
    );
    expect(editor.status).toBe(403);

    const adminToken = await signJwt(
      { sub: 1, username: 'admin', role: 'admin', ver: 0 },
      SECRET,
      60,
    );
    const admin = await app.request(
      '/admin',
      { headers: { cookie: `eb_session=${adminToken}` } },
      sessionEnv(0),
    );
    expect(admin.status).toBe(200);
  });
});
