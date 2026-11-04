import type { HeroSettings } from '@shared/types';

/**
 * File extensions that browsers can play as background video. Uploaded media
 * always ends in `.mp4` / `.webm`; the extra formats keep hand-entered CDN links
 * working without a separate "is this a video?" switch in the admin UI.
 */
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'm4v', 'mov', 'ogv']);

/** True when a URL points at a video file (query string / hash ignored). */
export function isVideoUrl(url: string): boolean {
  const value = url.trim();
  if (!value) return false;
  if (/^data:video\//i.test(value)) return true;

  let pathname = value;
  try {
    pathname = new URL(value, 'https://placeholder.invalid').pathname;
  } catch {
    pathname = value.split(/[?#]/, 1)[0] ?? value;
  }

  const dot = pathname.lastIndexOf('.');
  if (dot < 0 || dot === pathname.length - 1) return false;
  return VIDEO_EXTENSIONS.has(pathname.slice(dot + 1).toLowerCase());
}

export interface HeroMedia {
  kind: 'none' | 'image' | 'video';
  /** Value shown in the single admin URL field. */
  value: string;
  /** Image URL for the CSS background / video poster. */
  image: string;
  /** Video URL when the media is a video. */
  video: string;
  /** Optional poster for legacy image + video combinations. */
  poster: string;
}

/**
 * Resolve the unified media field while staying compatible with settings saved
 * before `backgroundMedia` existed. Legacy videos win over the old poster image.
 */
export function resolveHeroMedia(
  hero: Pick<HeroSettings, 'backgroundMedia' | 'backgroundImage' | 'backgroundVideo'>,
): HeroMedia {
  const media = hero.backgroundMedia?.trim() ?? '';
  if (media) {
    return isVideoUrl(media)
      ? { kind: 'video', value: media, image: '', video: media, poster: '' }
      : { kind: 'image', value: media, image: media, video: '', poster: '' };
  }

  const image = hero.backgroundImage?.trim() ?? '';
  const video = hero.backgroundVideo?.trim() ?? '';
  if (video) {
    return { kind: 'video', value: video, image, video, poster: image };
  }
  if (image) {
    return { kind: 'image', value: image, image, video: '', poster: '' };
  }
  return { kind: 'none', value: '', image: '', video: '', poster: '' };
}
