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
import {
  EXT_BY_MIME,
  IMAGE_MAX_SIZE,
  THUMBNAIL_MAX_SIZE,
  VIDEO_MAX_SIZE,
  isVideoMime,
  keyFromPublicUrl,
  sniffImageMime,
  sniffMediaMime,
  thumbnailKey,
} from '../lib/media-file';

export const mediaRoutes = new Hono<AppEnv>();

mediaRoutes.use('*', requireAuth);

/** 视频封面允许的图片类型（浏览器抽帧只会产出这三类）。 */
const THUMBNAIL_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

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
  const prefix = base || (isVideoMime(mime) ? 'video' : 'image');
  return `uploads/${year}/${month}/${prefix}-${randomToken(6)}.${ext}`;
}

mediaRoutes.get('/', async (c) => {
  const parsed = paginationSchema
    .extend({
      q: z.string().trim().max(100).optional(),
      /** Restrict the picker to images or videos. */
      kind: z.enum(['image', 'video']).optional(),
    })
    .safeParse(c.req.query());
  if (!parsed.success) throw AppError.validation('查询参数校验失败', parsed.error.flatten());
  const { page, perPage, q, kind } = parsed.data;
  c.header('Cache-Control', 'no-store');

  const conditions: string[] = [];
  const binds: unknown[] = [];
  if (q) {
    conditions.push('(filename LIKE ? OR key LIKE ?)');
    binds.push(`%${q}%`, `%${q}%`);
  }
  if (kind) {
    conditions.push('mime LIKE ?');
    binds.push(`${kind}/%`);
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

  // Verify the actual content, not just the declared MIME (which clients spoof).
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const mime = sniffMediaMime(head);
  if (!mime || !(mime in EXT_BY_MIME)) {
    throw AppError.unsupportedMedia('仅支持 JPG / PNG / GIF / WebP / AVIF / BMP 图片及 MP4 / WebM 视频');
  }
  const video = isVideoMime(mime);
  if (file.size > (video ? VIDEO_MAX_SIZE : IMAGE_MAX_SIZE)) {
    throw AppError.payloadTooLarge(video ? '视频超过 25MB 限制' : '图片超过 8MB 限制');
  }
  const declared =
    file.type === 'image/jpg'
      ? 'image/jpeg'
      : file.type === 'video/x-m4v'
        ? 'video/mp4'
        : file.type === 'video/x-matroska'
          ? 'video/webm'
          : file.type;
  if (declared && declared !== 'application/octet-stream' && declared !== mime) {
    throw AppError.unsupportedMedia('文件内容与声明的类型不一致');
  }

  const key = objectKey(file.name || (video ? 'video' : 'image'), mime);
  await c.env.MEDIA.put(key, file.stream(), {
    httpMetadata: {
      contentType: mime,
      cacheControl: 'public, max-age=31536000, immutable',
    },
  });

  // 视频封面：浏览器在客户端抽首帧生成，作为 multipart 的第二个文件一起上传。
  // 视频已经写入 R2，封面校验失败时把它删掉再报错，避免留下没有索引记录的孤儿对象。
  let thumb: { key: string; url: string } | null = null;
  const thumbEntry: unknown = form.get('thumbnail');
  if (video && thumbEntry instanceof File && thumbEntry.size > 0) {
    try {
      const thumbHead = new Uint8Array(await thumbEntry.slice(0, 32).arrayBuffer());
      const thumbMime = sniffImageMime(thumbHead);
      if (!thumbMime || !THUMBNAIL_MIMES.has(thumbMime)) {
        throw AppError.unsupportedMedia('视频封面仅支持 JPG / PNG / WebP 图片');
      }
      if (thumbEntry.size > THUMBNAIL_MAX_SIZE) {
        throw AppError.payloadTooLarge('视频封面超过 2MB 限制');
      }
      const thumbObjectKey = thumbnailKey(key, thumbMime);
      await c.env.MEDIA.put(thumbObjectKey, thumbEntry.stream(), {
        httpMetadata: {
          contentType: thumbMime,
          cacheControl: 'public, max-age=31536000, immutable',
        },
      });
      thumb = { key: thumbObjectKey, url: publicUrl(c.env, thumbObjectKey) };
    } catch (err) {
      await c.env.MEDIA.delete(key).catch(() => undefined);
      throw err;
    }
  }

  const url = publicUrl(c.env, key);
  let result: D1Result;
  try {
    result = await run(
      c.env,
      'INSERT INTO media (key, url, filename, size, mime, thumbnail_url) VALUES (?, ?, ?, ?, ?, ?)',
      key,
      url,
      file.name || null,
      file.size,
      mime,
      thumb?.url ?? null,
    );
  } catch (err) {
    // Roll the object back so a failed index write cannot leave a paid-for
    // orphan in R2 forever.
    await c.env.MEDIA.delete(key).catch(() => undefined);
    if (thumb) await c.env.MEDIA.delete(thumb.key).catch(() => undefined);
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
  const row = await first<{ key: string; thumbnail_url: string | null }>(
    c.env,
    'SELECT key, thumbnail_url FROM media WHERE id = ?',
    id,
  );
  if (!row) throw AppError.notFound('媒体不存在');

  await c.env.MEDIA.delete(row.key);
  // 视频封面是同一次上传写进 R2 的独立对象，删除视频时一并清理。
  if (row.thumbnail_url) {
    const thumbKey = keyFromPublicUrl(row.thumbnail_url, c.env.MEDIA_PUBLIC_BASE ?? '');
    if (thumbKey && thumbKey !== row.key) await c.env.MEDIA.delete(thumbKey).catch(() => undefined);
  }
  await run(c.env, 'DELETE FROM media WHERE id = ?', id);
  await recordAudit(c.env, c.get('user'), 'media.delete', 'media', id, { key: row.key });
  return ok(c, { deleted: true });
});
