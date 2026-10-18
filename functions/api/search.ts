import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../lib/env';
import { listPosts } from '../lib/posts-repo';
import { ok } from '../lib/response';
import { getSettings } from '../lib/settings';

export const searchRoutes = new Hono<AppEnv>();

const searchSchema = z.object({
  q: z.string().trim().min(1).max(100),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  perPage: z.coerce.number().int().min(1).max(30).default(10),
});

searchRoutes.get('/', async (c) => {
  c.header('Cache-Control', 'public, max-age=0, s-maxage=30');
  const settings = await getSettings(c.env);
  const parsed = searchSchema.safeParse(c.req.query());
  if (!settings.features.search || !parsed.success) {
    // A missing/too-short query is not an error — return an empty result set.
    return ok(c, [], { page: 1, perPage: 10, total: 0, totalPages: 1 });
  }
  const { q, page, perPage } = parsed.data;
  const result = await listPosts(c.env, { page, perPage, q, sort: 'newest' });
  return ok(c, result.items, {
    page: result.page,
    perPage: result.perPage,
    total: result.total,
    totalPages: result.totalPages,
  });
});
