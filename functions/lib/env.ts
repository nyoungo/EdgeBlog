/** Cloudflare bindings + Hono context variables. */
import { AppError } from './errors';

/**
 * Minimum length we accept for the JWT signing key. A short or missing secret
 * makes session tokens forgeable, so we refuse to serve the API instead of
 * silently signing with `undefined`.
 */
const MIN_SECRET_LENGTH = 32;

export function assertSecrets(env: Env): void {
  if (typeof env.JWT_SECRET !== 'string' || env.JWT_SECRET.trim().length < MIN_SECRET_LENGTH) {
    throw AppError.internal(
      `JWT_SECRET 未配置或长度不足 ${MIN_SECRET_LENGTH} 字符，请执行 wrangler pages secret put JWT_SECRET 后重试`,
    );
  }
}

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
  /** Users.token_version at issue time; bumping it revokes older tokens. */
  tokenVersion: number;
}

export interface JwtPayload {
  sub: number;
  username: string;
  role: Role;
  /** Absent on tokens issued before session versioning existed; treated as 0. */
  ver?: number;
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
