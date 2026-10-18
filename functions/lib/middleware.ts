/** Cross-cutting HTTP middleware: request id, security headers, CORS, CSRF. */
import type { Context, MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { randomToken } from './crypto';
import type { AppEnv } from './env';
import { AppError } from './errors';

export const requestId: MiddlewareHandler<AppEnv> = async (c, next) => {
  const id = c.req.header('cf-ray') ?? randomToken(8);
  c.set('requestId', id);
  c.header('X-Request-Id', id);
  await next();
};

/**
 * Security headers for API responses. Dangerous header values are omitted on
 * purpose: JSON never needs a document CSP, so we keep the surface minimal.
 */
export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  // Default API responses are uncacheable; read routes override this before
  // returning (a handler's later `c.header` wins over this pre-`next` default).
  c.header('Cache-Control', 'no-store');
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Cross-Origin-Resource-Policy', 'same-origin');
  c.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  if ((c.env.ENVIRONMENT ?? 'production') !== 'development') {
    c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
};

function allowedOriginHosts(c: { env: AppEnv['Bindings']; req: { url: string } }): Set<string> {
  const hosts = new Set<string>();
  if (c.env.SITE_URL) {
    try {
      hosts.add(new URL(c.env.SITE_URL).host);
    } catch {
      /* ignore malformed SITE_URL */
    }
  }
  for (const entry of (c.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim())) {
    if (!entry || entry === '*') continue;
    try {
      hosts.add(new URL(entry).host);
    } catch {
      /* ignore */
    }
  }
  return hosts;
}

/**
 * CSRF guard: state-changing requests must be same-origin. We accept a request
 * when (a) `Sec-Fetch-Site` says same-origin/same-site/none and (b) any
 * `Origin` header matches the request host or an allow-listed host.
 */
export const csrfGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();

  const secFetchSite = c.req.header('sec-fetch-site');
  if (secFetchSite && !['same-origin', 'same-site', 'none'].includes(secFetchSite)) {
    throw AppError.forbidden('跨站请求已被拒绝 (CSRF)');
  }

  const origin = c.req.header('origin');
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw AppError.forbidden('非法 Origin');
    }
    const requestHost = new URL(c.req.url).host;
    const allowed = allowedOriginHosts(c);
    // NOTE: ALLOWED_ORIGINS "*" is a CORS allowance for *reads*; it must never
    // relax CSRF. Same-origin writes pass because originHost === requestHost.
    if (originHost !== requestHost && !allowed.has(originHost)) {
      throw AppError.forbidden('Origin 不被信任 (CSRF)');
    }
  }

  return next();
};

export const corsMiddleware: MiddlewareHandler<AppEnv> = cors({
  origin: (origin: string, c: Context<AppEnv>) => {
    if (!origin) return '';
    const requestHost = new URL(c.req.url).host;
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return '';
    }
    if (originHost === requestHost) return origin;
    const allowAll = (c.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).includes('*');
    if (allowAll || allowedOriginHosts(c).has(originHost)) return origin;
    return '';
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  maxAge: 600,
});
