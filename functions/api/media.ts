import { Hono } from 'hono';
import { z } from 'zod';
import type { MediaItem, MediaUsage } from '@shared/types';
import { requireAuth } from '../lib/auth';
import { hashIp } from '../lib/crypto';
import { all, first, placeholders, run } from '../lib/db';
import type { AppEnv } from '../lib/env';
import { AppError } from '../lib/errors';
import { hit } from '../lib/rate-limit';
import { created, ok } from '../lib/response';
import { paginationSchema } from '../lib/validate';
import { recordAudit } from '../lib/audit';
import { mediaObjectKey, mediaPublicUrl } from '../lib/media-store';
import { loadImageSource } from '../lib/media-ingest';
import { mediaInUseSql, unusedMediaSummary } from '../lib/media-usage';
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

function publicUrl(env: { MEDIA_PUBLIC_BASE?: string }, key: string): string {
  return mediaPublicUrl(env.MEDIA_PUBLIC_BASE, key);
}

function objectKey(originalName: string, mime: string): string {
  return mediaObjectKey(originalName, mime);
}

mediaRoutes.get('/', async (c) => {
  const parsed = paginationSchema
    .extend({
      q: z.string().trim().max(100).optional(),
      /** Restrict the picker to images or videos. */
      kind: z.enum(['image', 'video']).optional(),
      /** 媒体库筛选用：只看已使用 / 未使用的文件。 */
      usage: z.enum(['used', 'unused']).optional(),
      /** 传 `1` 才计算「是否使用」与未使用汇总；媒体选择器不需要，省一次全表扫描。 */
      stats: z.literal('1').optional(),
    })
    .safeParse(c.req.query());
  if (!parsed.success) throw AppError.validation('查询参数校验失败', parsed.error.flatten());
  const { page, perPage, q, kind, usage, stats } = parsed.data;
  c.header('Cache-Control', 'no-store');

  const conditions: string[] = [];
  const binds: unknown[] = [];
  if (q) {
    // D1 的 LIKE pattern 上限 50 字节，长文件名/长关键词会直接报错，改用 instr。
    conditions.push('(instr(lower(m.filename), lower(?)) > 0 OR instr(lower(m.key), lower(?)) > 0)');
    binds.push(q, q);
  }
  if (kind) {
    conditions.push('m.mime LIKE ?');
    binds.push(`${kind}/%`);
  }
  const whereWith = (extra: string | null) => {
    const clauses = extra ? [...conditions, extra] : conditions;
    return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  };

  const wantsUsage = stats === '1' || Boolean(usage);

  /**
   * 一次查询拿总数、未使用汇总与当前页数据。
   *
   * `sql` 为 null 时完全不引用判定条件——用于「使用状态统计失败」后的降级：
   * 老库缺列/缺表时媒体列表仍要能用，只是不显示徽标。
   */
  const runList = async (sql: string | null) => {
    const usageCondition = usage && sql ? (usage === 'used' ? sql : `NOT ${sql}`) : null;
    const where = whereWith(usageCondition);
    const [totalRow, summary, rows] = await Promise.all([
      first<{ total: number }>(c.env, `SELECT COUNT(*) AS total FROM media m ${where}`, ...binds),
      sql && stats === '1' ? unusedMediaSummary(c.env, sql) : Promise.resolve(null),
      all<MediaItem>(
        c.env,
        `SELECT m.*${sql && stats === '1' ? `, CASE WHEN ${sql} THEN 1 ELSE 0 END AS in_use` : ''}
           FROM media m ${where}
          ORDER BY m.created_at DESC, m.id DESC
          LIMIT ? OFFSET ?`,
        ...binds,
        perPage,
        (page - 1) * perPage,
      ),
    ]);
    return { total: totalRow?.total ?? 0, summary, rows };
  };

  const respond = (result: Awaited<ReturnType<typeof runList>>, usageError?: string) =>
    ok(c, result.rows, {
      page,
      perPage,
      total: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / perPage)),
      ...(result.summary ? { unused: result.summary.count, unusedBytes: result.summary.bytes } : {}),
      ...(usageError ? { usageError } : {}),
    });

  if (!wantsUsage) return respond(await runList(null));

  // 「已使用 / 未使用」筛选与徽标依赖同一份判定 SQL；探测失败时降级。
  let usageSql: string | null = null;
  try {
    usageSql = await mediaInUseSql(c.env);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[media] usage detection failed', err);
    if (usage) throw AppError.internal(`媒体使用状态查询失败：${message}`);
    return respond(await runList(null), message);
  }

  try {
    return respond(await runList(usageSql));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[media] usage query failed', err);
    // 用了「已使用 / 未使用」筛选时结果必须准确，不能降级成错误列表。
    if (usage) throw AppError.internal(`媒体使用状态查询失败：${message}`);
    return respond(await runList(null), message);
  }
});

/**
 * Admin: 取回一张图片的原始字节（文章编辑器推送前在浏览器里转码用）。
 *
 * 只做「读 R2 / 下载外链 + 原样返回」，**不解码也不压缩**：免费版 Worker 每个
 * 请求只有 10ms CPU，这里必须是可以忽略的搬运工作。外链沿用
 * `loadImageSource` 的 SSRF 防护与体积上限。
 */
mediaRoutes.get('/proxy', async (c) => {
  const raw = (c.req.query('url') ?? '').trim();
  if (!raw) throw AppError.badRequest('缺少 url 参数');
  const isHttp = /^https?:\/\//i.test(raw);
  const isLocal = raw.startsWith('/') && !raw.startsWith('//');
  if (!isHttp && !isLocal) throw AppError.badRequest('url 必须是 http(s) 地址或站内 /media/ 路径');

  const loaded = await loadImageSource(c.env, raw, {
    maxSize: IMAGE_MAX_SIZE,
    maxSizeMessage: '图片超过 8MB 限制',
  });
  return new Response(loaded.bytes, {
    headers: {
      'Content-Type': loaded.mime || 'application/octet-stream',
      'Content-Length': String(loaded.bytes.byteLength),
      'Cache-Control': 'private, max-age=600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

/**
 * 清理未使用的媒体（分批）。
 *
 * 免费版每个请求最多 50 个子请求，而每删一个对象就是一次 R2 调用，所以单批
 * 默认 20、上限 30，并返回 `remaining`，由前端循环调用直到清空。
 * 判定口径与列表里的「未使用」完全一致（`MEDIA_IN_USE_SQL`）。
 */
mediaRoutes.post('/cleanup-unused', async (c) => {
  const raw = Number.parseInt(c.req.query('limit') ?? '20', 10);
  const limit = Number.isFinite(raw) ? Math.min(30, Math.max(1, raw)) : 20;

  const usageSql = await mediaInUseSql(c.env).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[media] cleanup usage detection failed', err);
    throw AppError.internal(`清理未使用媒体失败：${message}`);
  });
  const rows = await all<{ id: number; key: string; thumbnail_url: string | null; size: number }>(
    c.env,
    `SELECT m.id, m.key, m.thumbnail_url, m.size
       FROM media m
      WHERE NOT ${usageSql}
      ORDER BY m.created_at ASC, m.id ASC
      LIMIT ?`,
    limit,
  ).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[media] cleanup query failed', err);
    throw AppError.internal(`清理未使用媒体失败：${message}`);
  });
  if (rows.length === 0) {
    return ok(c, { deleted: 0, remaining: 0, freedBytes: 0, keys: [] as string[] });
  }

  let freedBytes = 0;
  for (const row of rows) {
    // 先删对象再删索引：R2 失败就让整批失败，避免留下「有记录、无对象」的死链。
    await c.env.MEDIA.delete(row.key);
    if (row.thumbnail_url) {
      const thumbKey = keyFromPublicUrl(row.thumbnail_url, c.env.MEDIA_PUBLIC_BASE ?? '');
      if (thumbKey && thumbKey !== row.key) {
        await c.env.MEDIA.delete(thumbKey).catch(() => undefined);
      }
    }
    freedBytes += row.size;
  }
  await run(
    c.env,
    `DELETE FROM media WHERE id IN (${placeholders(rows.length)})`,
    ...rows.map((row) => row.id),
  );

  const summary = await unusedMediaSummary(c.env, usageSql).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[media] cleanup summary failed', err);
    throw AppError.internal(`已清理 ${rows.length} 个文件，但统计剩余数量失败：${message}`);
  });
  await recordAudit(c.env, c.get('user'), 'media.cleanup', 'media', null, {
    deleted: rows.length,
    freedBytes,
    keys: rows.slice(0, 10).map((row) => row.key),
  });
  return ok(c, {
    deleted: rows.length,
    remaining: summary.count,
    freedBytes,
    keys: rows.map((row) => row.key),
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
        AND (cover_url = ? OR og_image = ? OR instr(content_md, ?) > 0 OR instr(content_md, ?) > 0)
      ORDER BY updated_at DESC LIMIT 50`,
    row.url,
    row.url,
    row.key,
    row.url,
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
