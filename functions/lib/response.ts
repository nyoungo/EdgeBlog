/** Uniform API envelope: every endpoint returns { ok, ... }. */
import type { Context } from 'hono';
import type { ApiMeta, ApiResponse } from '@shared/types';
import type { AppEnv } from './env';
import { AppError } from './errors';

type Ctx = Context<AppEnv>;

export function ok<T>(c: Ctx, data: T, meta?: ApiMeta): Response {
  const body: ApiResponse<T> = meta ? { ok: true, data, meta } : { ok: true, data };
  return c.json(body);
}

export function created<T>(c: Ctx, data: T, meta?: ApiMeta): Response {
  const body: ApiResponse<T> = meta ? { ok: true, data, meta } : { ok: true, data };
  return c.json(body, 201);
}

export function fail(
  c: Ctx,
  code: AppError['code'] | string,
  message: string,
  status = 400,
  details?: unknown,
): Response {
  const error: { code: string; message: string; details?: unknown } = { code, message };
  if (details !== undefined) error.details = details;
  const body: ApiResponse<never> = { ok: false, error };
  return c.json(body, status as 400);
}
