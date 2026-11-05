/**
 * Media upload helpers: content sniffing and HTTP Range parsing.
 *
 * Kept free of Hono / Workers globals so the tricky parts can be unit-tested.
 */

/** Raster images stay small; video gets a more generous (but still safe) cap. */
export const IMAGE_MAX_SIZE = 8 * 1024 * 1024; // 8 MB
export const VIDEO_MAX_SIZE = 25 * 1024 * 1024; // 25 MB
/** 视频封面由浏览器抽帧生成，体积很小，限制得比普通图片更严格。 */
export const THUMBNAIL_MAX_SIZE = 2 * 1024 * 1024; // 2 MB

/**
 * Raster images plus MP4/WebM video. SVG is intentionally rejected: it can
 * carry scripts and would be an XSS vector when served inline from our origin.
 */
export const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

export function isVideoMime(mime: string): boolean {
  return mime.startsWith('video/');
}

function at(bytes: Uint8Array, i: number): number {
  return bytes[i] ?? -1;
}

/**
 * Identify a raster image from its magic bytes. The browser-supplied
 * `File.type` is attacker-controlled, so it is only used as a hint: an HTML or
 * script payload renamed to `.png` must not be stored with `image/png`.
 */
export function sniffImageMime(bytes: Uint8Array): string | null {
  if (at(bytes, 0) === 0xff && at(bytes, 1) === 0xd8 && at(bytes, 2) === 0xff) return 'image/jpeg';
  if (
    at(bytes, 0) === 0x89 && at(bytes, 1) === 0x50 && at(bytes, 2) === 0x4e && at(bytes, 3) === 0x47 &&
    at(bytes, 4) === 0x0d && at(bytes, 5) === 0x0a && at(bytes, 6) === 0x1a && at(bytes, 7) === 0x0a
  ) {
    return 'image/png';
  }
  if (at(bytes, 0) === 0x47 && at(bytes, 1) === 0x49 && at(bytes, 2) === 0x46 && at(bytes, 3) === 0x38) return 'image/gif';
  if (at(bytes, 0) === 0x42 && at(bytes, 1) === 0x4d) return 'image/bmp';
  if (
    at(bytes, 0) === 0x52 && at(bytes, 1) === 0x49 && at(bytes, 2) === 0x46 && at(bytes, 3) === 0x46 &&
    at(bytes, 8) === 0x57 && at(bytes, 9) === 0x45 && at(bytes, 10) === 0x42 && at(bytes, 11) === 0x50
  ) {
    return 'image/webp';
  }
  if (at(bytes, 4) === 0x66 && at(bytes, 5) === 0x74 && at(bytes, 6) === 0x79 && at(bytes, 7) === 0x70) {
    const brand = String.fromCharCode(at(bytes, 8), at(bytes, 9), at(bytes, 10), at(bytes, 11));
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
  }
  return null;
}

/** ISO base media brands that represent playable MP4 video. */
const MP4_VIDEO_BRANDS = new Set([
  'isom',
  'iso2',
  'iso3',
  'iso4',
  'iso5',
  'iso6',
  'mp41',
  'mp42',
  'avc1',
  'M4V ',
  'M4VH',
  'M4VP',
  'dash',
  'cmfc',
]);

/**
 * Identify MP4 / WebM video from magic bytes.
 *
 * WebM and Matroska share the same EBML header; the DocType sits deeper than
 * the 32-byte sniff window, so anything EBML-based is accepted and served as
 * `video/webm` (browsers that support WebM play it; nosniff stays on).
 */
export function sniffVideoMime(bytes: Uint8Array): string | null {
  if (at(bytes, 0) === 0x1a && at(bytes, 1) === 0x45 && at(bytes, 2) === 0xdf && at(bytes, 3) === 0xa3) {
    return 'video/webm';
  }
  if (at(bytes, 4) === 0x66 && at(bytes, 5) === 0x74 && at(bytes, 6) === 0x79 && at(bytes, 7) === 0x70) {
    const brand = String.fromCharCode(at(bytes, 8), at(bytes, 9), at(bytes, 10), at(bytes, 11));
    if (MP4_VIDEO_BRANDS.has(brand)) return 'video/mp4';
  }
  return null;
}

export function sniffMediaMime(bytes: Uint8Array): string | null {
  return sniffImageMime(bytes) ?? sniffVideoMime(bytes);
}

export interface ByteRange {
  offset: number;
  length: number;
}

/**
 * 视频封面的 R2 key：与视频同目录、同名，加 `-thumb` 后缀。
 * 例如 `uploads/2026/11/hero-abc.mp4` → `uploads/2026/11/hero-abc-thumb.jpg`。
 */
export function thumbnailKey(videoKey: string, mime: string): string {
  const ext = EXT_BY_MIME[mime] ?? 'jpg';
  const base = videoKey.replace(/\.[^./]+$/, '');
  return `${base}-thumb.${ext}`;
}

/**
 * 由公开 URL 反推 R2 key（删除媒体时用来一并清理封面）。
 * `publicBase` 传 MEDIA_PUBLIC_BASE；为空表示默认的 `/media/` 前缀。
 */
export function keyFromPublicUrl(url: string, publicBase = ''): string | null {
  const base = publicBase.replace(/\/+$/, '');
  const prefix = base ? `${base}/` : '/media/';
  if (!url.startsWith(prefix)) return null;
  const key = url.slice(prefix.length);
  if (!key || key.includes('..')) return null;
  return key;
}

/**
 * Parse a single `Range: bytes=…` header. Returns `null` for an absent or
 * unsatisfiable/multi-range header; callers should answer 416 only when a
 * Range header was actually present.
 */
export function parseByteRange(header: string | null, size: number): ByteRange | null {
  if (!header || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const rawStart = match[1] ?? '';
  const rawEnd = match[2] ?? '';
  if (!rawStart && !rawEnd) return null;

  let start: number;
  let end: number;
  if (!rawStart) {
    // Suffix range: the last N bytes.
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
  }
  if (start < 0 || start >= size || end < start) return null;
  end = Math.min(end, size - 1);
  return { offset: start, length: end - start + 1 };
}
