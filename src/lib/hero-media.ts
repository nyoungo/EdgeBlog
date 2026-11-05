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
 *
 * 视频的 `poster` 存在 `backgroundImage` 里（后台「视频封面图」），同时充当
 * 移动端/视频加载前的退避背景图，所以 video 场景下 `image` 与 `poster` 相同。
 */
export function resolveHeroMedia(
  hero: Pick<HeroSettings, 'backgroundMedia' | 'backgroundImage' | 'backgroundVideo'>,
): HeroMedia {
  const rawPoster = hero.backgroundImage?.trim() ?? '';
  const poster = rawPoster && !isVideoUrl(rawPoster) ? rawPoster : '';
  const media = hero.backgroundMedia?.trim() ?? '';
  if (media) {
    return isVideoUrl(media)
      ? { kind: 'video', value: media, image: poster, video: media, poster }
      : { kind: 'image', value: media, image: media, video: '', poster: '' };
  }

  const video = hero.backgroundVideo?.trim() ?? '';
  if (video) {
    return { kind: 'video', value: video, image: poster, video, poster };
  }
  if (poster) {
    return { kind: 'image', value: poster, image: poster, video: '', poster: '' };
  }
  return { kind: 'none', value: '', image: '', video: '', poster: '' };
}
