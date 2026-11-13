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
  sniffImageMime,
  sniffMediaMime,
} from './media-file';
import { mediaObjectKey, mediaPublicUrl } from './media-store';

export const REMOTE_FETCH_TIMEOUT_MS = 30_000;

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
  opts: { imageOnly?: boolean } = {},
): Promise<DownloadedMedia> {
  const url = assertRemoteUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'EdgeBlog-AI/1.0' },
    });
  } catch (err) {
    throw AppError.upstream(
      err instanceof Error && err.name === 'AbortError'
        ? '下载媒体超时,请稍后重试'
        : '无法下载媒体,请检查地址是否可访问',
    );
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw AppError.upstream(`下载媒体失败(HTTP ${response.status})`);
  // `fetch` follows redirects; re-check the final host so a public URL cannot
  // bounce the request into the private network.
  if (response.url) {
    try {
      if (isPrivateHost(new URL(response.url).hostname)) {
        throw AppError.badRequest('不允许从内网地址下载媒体');
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
    }
  }

  const maxSize = opts.imageOnly ? THUMBNAIL_MAX_SIZE : VIDEO_MAX_SIZE;
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxSize) {
    throw AppError.payloadTooLarge(opts.imageOnly ? '封面图超过 2MB 限制' : '媒体文件超过 25MB 限制');
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) throw AppError.badRequest('下载到的文件为空');
  if (bytes.byteLength > maxSize) {
    throw AppError.payloadTooLarge(opts.imageOnly ? '封面图超过 2MB 限制' : '媒体文件超过 25MB 限制');
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
  const media = await downloadRemote(rawUrl);
  if (isVideoMime(media.mime)) throw AppError.unsupportedMedia('封面必须是图片');
  if (media.bytes.byteLength > IMAGE_MAX_SIZE) throw AppError.payloadTooLarge('图片超过 8MB 限制');

  const filename = filenameFromUrl(rawUrl) || filenameHint;
  const key = mediaObjectKey(filename, media.mime);
  await env.MEDIA.put(key, media.bytes, {
    httpMetadata: {
      contentType: media.mime,
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
      media.bytes.byteLength,
      media.mime,
      null,
    );
    return { id: Number(result.meta.last_row_id), url, mime: media.mime, size: media.bytes.byteLength };
  } catch (err) {
    // 索引写失败就把对象删掉,避免 R2 里留下没有记录的孤儿文件。
    await env.MEDIA.delete(key).catch(() => undefined);
    throw err;
  }
}
