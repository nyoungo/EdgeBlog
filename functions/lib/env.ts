/** Cloudflare bindings + Hono context variables. */

export interface Env {
  /** D1 relational database. */
  DB: D1Database;
  /** R2 bucket for the media library. */
  MEDIA: R2Bucket;
  /** KV namespace used for settings cache + rate-limit counters. */
  CACHE: KVNamespace;
  /** Pages static asset fetcher (present in Pages Functions). */
  ASSETS: Fetcher;

  /** Secret: HMAC key for JWTs. Set via `wrangler pages secret put`. */
  JWT_SECRET: string;

  ENVIRONMENT?: string;
  SITE_URL?: string;
  MEDIA_PUBLIC_BASE?: string;
  SESSION_COOKIE?: string;
  ALLOWED_ORIGINS?: string;
}

export type Role = 'admin' | 'editor';

export interface SessionUser {
  id: number;
  username: string;
  role: Role;
}

export interface JwtPayload {
  sub: number;
  username: string;
  role: Role;
  iat: number;
  exp: number;
}

/** Hono environment: bindings + per-request variables. */
export type AppEnv = {
  Bindings: Env;
  Variables: {
    user: SessionUser | null;
    ipHash: string;
    requestId: string;
  };
};
