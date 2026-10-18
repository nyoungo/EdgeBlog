/** Minimal HS256 JWT implementation (no external dependency). */
import { fromBase64Url, hmacKey, timingSafeEqual, toBase64Url } from './crypto';
import type { JwtPayload } from './env';

const encoder = new TextEncoder();

export interface JwtClaims {
  sub: number;
  username: string;
  role: 'admin' | 'editor';
}

function encodeSegment(value: unknown): string {
  return toBase64Url(encoder.encode(JSON.stringify(value)));
}

export async function signJwt(
  claims: JwtClaims,
  secret: string,
  expiresInSeconds: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload: JwtPayload = { ...claims, iat: now, exp: now + expiresInSeconds };
  const signingInput = `${encodeSegment(header)}.${encodeSegment(payload)}`;
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput));
  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];
  const signingInput = `${headerB64}.${payloadB64}`;
  try {
    const key = await hmacKey(secret);
    const expected = await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput));
    if (!timingSafeEqual(fromBase64Url(sigB64), new Uint8Array(expected))) return null;

    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64))) as JwtPayload;
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (typeof payload.sub !== 'number' || typeof payload.username !== 'string') return null;
    if (payload.role !== 'admin' && payload.role !== 'editor') return null;
    return payload;
  } catch {
    return null;
  }
}
