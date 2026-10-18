import { Hono } from 'hono';
import type { MediaItem } from '@shared/types';
import { requireAuth } from '../lib/auth';
import { randomToken } from '../lib/crypto';
import { all, first, run } from '../lib/db';
import type { AppEnv, Env } from '../lib/env';
import { AppError } from '../lib/errors';
import { created, ok } from '../lib/response';
import { paginationSchema } from '../lib/validate';
import { nowSql } from '../lib/datetime';

export const mediaRoutes = new Hono<AppEnv>();

mediaRoutes.use('*', requireAuth);

const MAX_SIZE = 8 * 1024 * 1024; // 8 MB

/**
 * Raster types only. SVG is intentionally rejected: it can carry scripts and
 * would be an XSS vector when served inline from our own origin.
 */
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
};

/**
 * Public URL stored in `media.url`.
 *
 * Default (MEDIA_PUBLIC_BASE unset) is the **relative** path `/media/<key>`:
 * it works on any hostname, so binding/renaming a custom domain never
 * invalidates existing records (and RSS/sitemap/OG absolutize it against
 * SITE_URL via `absoluteUrl` in lib/seo.ts).
 * Set MEDIA_PUBLIC_BASE only when R2 is fronted by its own custom domain.
 */
function publicUrl(env: Env, key: string): string {
  const base = (env.MEDIA_PUBLIC_BASE ?? '').replace(/\/+$/, '');
  return base ? `${base}/${key}` : `/media/${key}`;
}

function objectKey(originalName: string, mime: string): string {
  const ext = EXT_BY_MIME[mime] ?? 'bin';
  const now = nowSql(); // "YYYY-MM-DD HH:MM:SS"
  const [year, month] = now.split('-');
  // Keep the original basename for readability, strip anything unsafe.
  const base = originalName
    .replace(/\.[^.]+$/, '')
    .replace(/[^\w.-]+/g, '-')
    .slice(0, 60)
    .replace(/^-+|-+$/g, '');
  const prefix = base || 'image';
  return `uploads/${year}/${month}/${prefix}-${randomToken(6)}.${ext}`;
}

mediaRoutes.get('/', async (c) => {
  const parsed = paginationSchema.safeParse(c.req.query());
  if (!parsed.success) throw AppError.validation('查询参数校验失败', parsed.error.flatten());
  const { page, perPage } = parsed.data;
  c.header('Cache-Control', 'no-store');

  const totalRow = await first<{ total: number }>(c.env, 'SELECT COUNT(*) AS total FROM media');
  const total = totalRow?.total ?? 0;
  const rows = await all<MediaItem>(
    c.env,
    'SELECT * FROM media ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
    perPage,
    (page - 1) * perPage,
  );
  return ok(c, rows, {
    page,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  });
});

mediaRoutes.post('/upload', async (c) => {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw AppError.badRequest('请求必须是 multipart/form-data');
  }
  // workers-types types FormData.get as `string | null`; the real runtime may
  // return a File for multipart parts, so widen and narrow explicitly.
  const entry: unknown = form.get('file');
  if (!(entry instanceof File)) throw AppError.badRequest('缺少文件字段 file');
  const file = entry;
  if (file.size === 0) throw AppError.badRequest('文件为空');
  if (file.size > MAX_SIZE) throw AppError.payloadTooLarge('文件超过 8MB 限制');

  const mime = file.type || 'application/octet-stream';
  if (!(mime in EXT_BY_MIME)) {
    throw AppError.unsupportedMedia('仅支持 JPG / PNG / GIF / WebP / AVIF / BMP 图片');
  }

  const key = objectKey(file.name || 'image', mime);
  await c.env.MEDIA.put(key, file.stream(), {
    httpMetadata: {
      contentType: mime,
      cacheControl: 'public, max-age=31536000, immutable',
    },
  });

  const url = publicUrl(c.env, key);
  const result = await run(
    c.env,
    'INSERT INTO media (key, url, filename, size, mime) VALUES (?, ?, ?, ?, ?)',
    key,
    url,
    file.name || null,
    file.size,
    mime,
  );

  const row = await first<MediaItem>(
    c.env,
    'SELECT * FROM media WHERE id = ?',
    result.meta.last_row_id,
  );
  return created(c, row);
});

mediaRoutes.delete('/:id', async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id)) throw AppError.badRequest('非法媒体 ID');
  const row = await first<{ key: string }>(c.env, 'SELECT key FROM media WHERE id = ?', id);
  if (!row) throw AppError.notFound('媒体不存在');

  await c.env.MEDIA.delete(row.key);
  await run(c.env, 'DELETE FROM media WHERE id = ?', id);
  return ok(c, { deleted: true });
});
