/**
 * Best-effort rate limiting backed by KV + a D1 audit ledger for auth.
 *
 * KV is eventually consistent, so this deters casual abuse rather than
 * providing a hard guarantee. The D1 `login_attempts` table gives a durable
 * trail that a future stricter check could enforce without changing callers.
 */
import type { Env } from './env';

export interface RateResult {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
}

export async function hit(
  env: Env,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateResult> {
  if (!env.CACHE) return { allowed: true, remaining: limit, resetSeconds: 0 };
  const k = `rl:${key}`;
  try {
    const current = Number.parseInt((await env.CACHE.get(k)) ?? '0', 10) || 0;
    if (current >= limit) {
      return { allowed: false, remaining: 0, resetSeconds: windowSeconds };
    }
    await env.CACHE.put(k, String(current + 1), { expirationTtl: windowSeconds });
    return { allowed: true, remaining: limit - current - 1, resetSeconds: windowSeconds };
  } catch {
    // Never fail closed on limiter storage errors — availability first.
    return { allowed: true, remaining: limit, resetSeconds: 0 };
  }
}

/** Remove a counter (e.g. clear the login budget after a successful login). */
export async function clear(env: Env, key: string): Promise<void> {
  if (!env.CACHE) return;
  try {
    await env.CACHE.delete(`rl:${key}`);
  } catch {
    /* ignore */
  }
}
