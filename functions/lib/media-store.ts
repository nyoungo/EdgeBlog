/**
 * Media object naming + public URLs.
 *
 * Shared by the multipart upload route and the AI "upload from URL" tool so
 * both write the same keys and return the same kind of link.
 */
import { randomToken } from './crypto';
import { nowSql } from './datetime';
import { EXT_BY_MIME, isVideoMime } from './media-file';

/**
 * Public URL stored in `media.url`.
 *
 * Default (MEDIA_PUBLIC_BASE unset) is the relative path `/media/<key>`:
 * it works on any hostname, so binding/renaming a custom domain never
 * invalidates existing records.
 */
export function mediaPublicUrl(base: string | undefined, key: string): string {
  const prefix = (base ?? '').replace(/\/+$/, '');
  return prefix ? `${prefix}/${key}` : `/media/${key}`;
}

/** Readable, collision-resistant R2 key for a new upload. */
export function mediaObjectKey(originalName: string, mime: string): string {
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
