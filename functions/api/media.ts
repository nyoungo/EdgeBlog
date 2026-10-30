import { Hono } from 'hono';
import { z } from 'zod';
import type { MediaItem, MediaUsage } from '@shared/types';
import { requireAuth } from '../lib/auth';
import { hashIp, randomToken } from '../lib/crypto';
import { all, first, run } from '../lib/db';
import type { AppEnv, Env } from '../lib/env';
import { AppError } from '../lib/errors';
import { hit } from '../lib/rate-limit';
import { created, ok } from '../lib/response';
import { paginationSchema } from '../lib/validate';
import { nowSql } from '../lib/datetime';
import { recordAudit } from '../lib/audit';

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
 * Identify a raster image from its magic bytes. The browser-supplied
 * `File.type` is attacker-controlled, so it is only used as a hint: an HTML or
 * script payload renamed to `.png` must not be stored with `image/png`.
 */
function sniffImageMime(bytes: Uint8Array): string | null {
  const at = (i: number): number => bytes[i] ?? -1;
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (
    at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 &&
    at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a
  ) {
    return 'image/png';
  }
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return 'image/gif';
  if (at(0) === 0x42 && at(1) === 0x4d) return 'image/bmp';
  if (
    at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 &&
    at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50
  ) {
    return 'image/webp';
  }
  if (at(4) === 0x66 && at(5) === 0x74 && at(6) === 0x79 && at(7) === 0x70) {
    const brand = String.fromCharCode(at(8), at(9), at(10), at(11));
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
  }
  return null;
}

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
  const parsed = paginationSchema.extend({ q: z.string().trim().max(100).optional() }).safeParse(c.req.query());
  if (!parsed.success) throw AppError.validation('查询参数校验失败', parsed.error.flatten());
  const { page, perPage, q } = parsed.data;
  c.header('Cache-Control', 'no-store');

  const conditions: string[] = [];
  const binds: unknown[] = [];
  if (q) {
    conditions.push('(filename LIKE ? OR key LIKE ?)');
    binds.push(`%${q}%`, `%${q}%`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const totalRow = await first<{ total: number }>(
    c.env,
    `SELECT COUNT(*) AS total FROM media ${where}`,
    ...binds,
  );
  const total = totalRow?.total ?? 0;
  const rows = await all<MediaItem>(
    c.env,
    `SELECT * FROM media ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    ...binds,
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

/** Which posts reference this object (cover, og image or inline Markdown)? */
mediaRoutes.get('/:id/usage', async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id)) throw AppError.badRequest('非法媒体 ID');
  const row = await first<{ key: string; url: string }>(
    c.env,
    'SELECT key, url FROM media WHERE id = ?',
    id,
  );
  if (!row) throw AppError.notFound('媒体不存在');
  c.header('Cache-Control', 'no-store');
  const rows = await all<MediaUsage>(
    c.env,
    `SELECT id, slug, title, status FROM posts
      WHERE deleted_at IS NULL
        AND (cover_url = ? OR og_image = ? OR content_md LIKE ? OR content_md LIKE ?)
      ORDER BY updated_at DESC LIMIT 50`,
    row.url,
    row.url,
    `%${row.key}%`,
    `%${row.url}%`,
  );
  return ok(c, rows);
});

mediaRoutes.post('/upload', async (c) => {
  // Limit before buffering the multipart body.
  const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown';
  const ipHash = await hashIp(ip, c.env.JWT_SECRET);
  const limit = await hit(c.env, `upload:${ipHash}`, 40, 3600);
  if (!limit.allowed) throw AppError.rateLimited('上传过于频繁，请稍后再试');

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

  // Verify the actual content, not just the declared MIME (which clients spoof).
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const mime = sniffImageMime(head);
  if (!mime || !(mime in EXT_BY_MIME)) {
    throw AppError.unsupportedMedia('仅支持 JPG / PNG / GIF / WebP / AVIF / BMP 图片');
  }
  const declared = file.type === 'image/jpg' ? 'image/jpeg' : file.type;
  if (declared && declared !== 'application/octet-stream' && declared !== mime) {
    throw AppError.unsupportedMedia('文件内容与声明的类型不一致');
  }

  const key = objectKey(file.name || 'image', mime);
  await c.env.MEDIA.put(key, file.stream(), {
    httpMetadata: {
      contentType: mime,
      cacheControl: 'public, max-age=31536000, immutable',
    },
  });

  const url = publicUrl(c.env, key);
  let result: D1Result;
  try {
    result = await run(
      c.env,
      'INSERT INTO media (key, url, filename, size, mime) VALUES (?, ?, ?, ?, ?)',
      key,
      url,
      file.name || null,
      file.size,
      mime,
    );
  } catch (err) {
    // Roll the object back so a failed index write cannot leave a paid-for
    // orphan in R2 forever.
    await c.env.MEDIA.delete(key).catch(() => undefined);
    throw err;
  }

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
  await recordAudit(c.env, c.get('user'), 'media.delete', 'media', id, { key: row.key });
  return ok(c, { deleted: true });
});
