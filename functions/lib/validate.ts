/** Request validation helpers built on zod. */
import type { Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from './env';
import { AppError } from './errors';

type Ctx = Context<AppEnv>;

/** Parse + validate a JSON body, throwing a typed 422 on failure. */
export async function parseJson<S extends z.ZodTypeAny>(c: Ctx, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw AppError.badRequest('请求体不是合法的 JSON');
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw AppError.validation('请求参数校验失败', result.error.flatten());
  }
  return result.data;
}

/** Parse + validate query string params (all values are strings). */
export function parseQuery<S extends z.ZodTypeAny>(c: Ctx, schema: S): z.infer<S> {
  const result = schema.safeParse(c.req.query());
  if (!result.success) {
    throw AppError.validation('查询参数校验失败', result.error.flatten());
  }
  return result.data;
}

/** Parse + validate the path params object. */
export function parseParams<S extends z.ZodTypeAny>(params: unknown, schema: S): z.infer<S> {
  const result = schema.safeParse(params);
  if (!result.success) {
    throw AppError.validation('路径参数校验失败', result.error.flatten());
  }
  return result.data;
}

/** Coerce a pagination query into safe integers. */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  perPage: z.coerce.number().int().min(1).max(50).default(10),
});
