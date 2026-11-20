/**
 * 公网媒体的下载与入库(SSRF 防护 + R2/media 写入)。
 *
 * 后台 AI 助手(从 URL 上传图片/视频)与定时发文(封面外链入库)共用同一套
 * 规则:校验协议/主机、跟随重定向后复查最终主机、按魔数判定真实类型、
 * 控制体积,最后写 R2 并在 `media` 表登记。
 */
import type { Env } from './env';
import { AppError } from './errors';
import { run } from './db';
import {
  EXT_BY_MIME,
  IMAGE_MAX_SIZE,
  THUMBNAIL_MAX_SIZE,
  VIDEO_MAX_SIZE,
  isVideoMime,
  keyFromPublicUrl,
  sniffImageMime,
  sniffMediaMime,
} from './media-file';
import { mediaObjectKey, mediaPublicUrl } from './media-store';
import { isAbortError, withTimeout } from './deadline';

export const REMOTE_FETCH_TIMEOUT_MS = 30_000;

/** 下载可选参数：`timeoutMs` 覆盖默认值（调用方按剩余预算收窄）。 */
export interface DownloadOptions {
  imageOnly?: boolean;
  maxSize?: number;
  maxSizeMessage?: string;
  /** 本次下载的总超时（覆盖 `REMOTE_FETCH_TIMEOUT_MS`）。 */
  timeoutMs?: number;
}

export interface DownloadedMedia {
  bytes: Uint8Array;
  mime: string;
}

export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }

  if (host.startsWith('[') || host.includes(':')) {
    if (host === '[::1]' || host === '::1') return true;
    if (host.startsWith('[fc') || host.startsWith('[fd')) return true;
    if (host.startsWith('[fe80')) return true;
  }
  return false;
}

/**
 * Validate an admin-supplied URL before fetching it server-side (SSRF guard).
 *
 * http 与 https 都放行:很多中文站点仍是纯 http,抓正文时会被直接跳过。
 * 抓取只发生在本站服务器,不涉及浏览器混合内容;内容本身按不可信数据处理。
 */
export function assertRemoteUrl(raw: string, label = '媒体地址'): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw AppError.badRequest(`${label}不是合法的 URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw AppError.badRequest(`${label}必须以 https:// 或 http:// 开头`);
  }
  if (url.username || url.password) throw AppError.badRequest(`${label}不能包含用户名或密码`);
  if (isPrivateHost(url.hostname)) throw AppError.badRequest(`不允许访问内网地址(${label})`);
  return url;
}

export async function downloadRemote(
  rawUrl: string,
  opts: DownloadOptions = {},
): Promise<DownloadedMedia> {
  const url = assertRemoteUrl(rawUrl);
  const timeoutMs = opts.timeoutMs ?? REMOTE_FETCH_TIMEOUT_MS;
  const timeoutMessage = '下载媒体超时,请稍后重试';

  // fetch 与读取响应体共用同一个超时窗口:只包 fetch 时,对方发完响应头
  // 不再发 body 会让 `arrayBuffer()` 一直挂着。
  const { response, bytes } = await withTimeout(
    async (signal) => {
      let res: Response;
      try {
        res = await fetch(url, {
          signal,
          redirect: 'follow',
          headers: { 'user-agent': 'EdgeBlog-AI/1.0' },
        });
      } catch (err) {
        if (isAbortError(err)) throw err;
        throw AppError.upstream('无法下载媒体,请检查地址是否可访问');
      }
      if (!res.ok) throw AppError.upstream(`下载媒体失败(HTTP ${res.status})`);
      // `fetch` follows redirects; re-check the final host so a public URL cannot
      // bounce the request into the private network.
      if (res.url) {
        try {
          if (isPrivateHost(new URL(res.url).hostname)) {
            throw AppError.badRequest('不允许从内网地址下载媒体');
          }
        } catch (err) {
          if (err instanceof AppError) throw err;
        }
      }
      return { response: res, bytes: new Uint8Array(await res.arrayBuffer()) };
    },
    timeoutMs,
    timeoutMessage,
  );

  const maxSize = opts.maxSize ?? (opts.imageOnly ? THUMBNAIL_MAX_SIZE : VIDEO_MAX_SIZE);
  const maxSizeMessage = opts.maxSizeMessage ?? (opts.imageOnly ? '封面图超过 2MB 限制' : '媒体文件超过 25MB 限制');
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxSize) {
    throw AppError.payloadTooLarge(maxSizeMessage);
  }

  if (bytes.byteLength === 0) throw AppError.badRequest('下载到的文件为空');
  if (bytes.byteLength > maxSize) {
    throw AppError.payloadTooLarge(maxSizeMessage);
  }

  const mime = opts.imageOnly ? sniffImageMime(bytes.slice(0, 32)) : sniffMediaMime(bytes.slice(0, 32));
  if (!mime || !(mime in EXT_BY_MIME)) {
    throw AppError.unsupportedMedia(
      opts.imageOnly
        ? '封面仅支持 JPG / PNG / GIF / WebP / AVIF / BMP 图片'
        : '仅支持 JPG / PNG / GIF / WebP / AVIF / BMP 图片及 MP4 / WebM 视频',
    );
  }
  if (opts.imageOnly && isVideoMime(mime)) throw AppError.unsupportedMedia('封面必须是图片');
  return { bytes, mime };
}

export function filenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const name = pathname.split('/').filter(Boolean).pop() ?? '';
    return decodeURIComponent(name);
  } catch {
    return '';
  }
}

export interface IngestedImage {
  id: number;
  url: string;
  mime: string;
  size: number;
}

export interface ImageSource {
  bytes: Uint8Array;
  mime: string;
  filename: string;
}

/**
 * 读取一张图片的字节：本站 `/media/...` 直接读 R2（不绕回自家域名），
 * 外链走带 SSRF 防护与体积上限的下载。
 *
 * 公众号推送、压缩工具、格式转换共用这一条链路，避免各写一套。
 */
export async function loadImageSource(
  env: Env,
  url: string,
  opts: { maxSize?: number; maxSizeMessage?: string; timeoutMs?: number } = {},
): Promise<ImageSource> {
  const raw = url.trim();
  if (!raw) throw AppError.badRequest('图片地址为空');
  const maxSize = opts.maxSize ?? IMAGE_MAX_SIZE;
  const maxSizeMessage = opts.maxSizeMessage ?? '图片超过 8MB 限制';

  if (raw.startsWith('/') && !raw.startsWith('//')) {
    const key = keyFromPublicUrl(raw, env.MEDIA_PUBLIC_BASE ?? '');
    if (!key) throw AppError.badRequest(`无法识别的站内图片地址：${raw}`);
    const object = await env.MEDIA.get(key);
    if (!object) throw AppError.badRequest(`站内图片不存在（可能已被删除）：${raw}`);
    if (object.size > maxSize) throw AppError.payloadTooLarge(maxSizeMessage);
    const bytes = new Uint8Array(await object.arrayBuffer());
    return {
      bytes,
      // 以文件魔数为准，不能信任 R2 metadata 或 URL 后缀。
      mime: sniffImageMime(bytes.slice(0, 32)) ?? '',
      filename: key.split('/').pop() ?? 'image',
    };
  }

  const media = await downloadRemote(raw, {
    imageOnly: true,
    maxSize,
    maxSizeMessage,
    timeoutMs: opts.timeoutMs,
  });
  return { bytes: media.bytes, mime: media.mime, filename: filenameFromUrl(raw) || 'image' };
}

/** 把图片字节写入 R2 与 `media` 表，返回公开地址。索引写失败时回滚 R2 对象。 */
export async function storeImageInMedia(
  env: Env,
  bytes: Uint8Array,
  mime: string,
  filename: string,
): Promise<IngestedImage> {
  const key = mediaObjectKey(filename, mime);
  await env.MEDIA.put(key, bytes, {
    httpMetadata: {
      contentType: mime,
      cacheControl: 'public, max-age=31536000, immutable',
    },
  });

  const url = mediaPublicUrl(env.MEDIA_PUBLIC_BASE, key);
  try {
    const result = await run(
      env,
      'INSERT INTO media (key, url, filename, size, mime, thumbnail_url) VALUES (?, ?, ?, ?, ?, ?)',
      key,
      url,
      filename,
      bytes.byteLength,
      mime,
      null,
    );
    return { id: Number(result.meta.last_row_id), url, mime, size: bytes.byteLength };
  } catch (err) {
    await env.MEDIA.delete(key).catch(() => undefined);
    throw err;
  }
}

/**
 * 从公网 URL 下载一张图片,存入 R2 并写入 `media` 表,返回入库结果。
 *
 * 与「从 URL 上传媒体」工具走同一条链路,但只接受图片、上限为图片档位,
 * 供定时发文的封面外链入库与 AI 助手配图复用。
 */
export async function ingestRemoteImage(
  env: Env,
  rawUrl: string,
  filenameHint = 'image',
): Promise<IngestedImage> {
  const media = await downloadRemote(rawUrl, {
    imageOnly: true,
    maxSize: IMAGE_MAX_SIZE,
    maxSizeMessage: '图片超过 8MB 限制',
  });
  if (isVideoMime(media.mime)) throw AppError.unsupportedMedia('封面必须是图片');

  const filename = filenameFromUrl(rawUrl) || filenameHint;
  return storeImageInMedia(env, media.bytes, media.mime, filename);
}
