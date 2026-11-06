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
  /** URL of whichever source wins the fallback chain. */
  value: string;
  /** Image URL for the CSS background / video poster. */
  image: string;
  /** Video URL when the media is a video. */
  video: string;
  /** Poster shown behind the video (same as `image` in the video case). */
  poster: string;
}

/**
 * Split the legacy unified `backgroundMedia` value into the two independent
 * fields the settings editor writes. The result never contains a legacy media
 * value, so a stale URL cannot override a freshly picked video or image.
 */
export function normalizeHeroMedia(
  hero: Pick<HeroSettings, 'backgroundMedia' | 'backgroundImage' | 'backgroundVideo'>,
): Pick<HeroSettings, 'backgroundMedia' | 'backgroundImage' | 'backgroundVideo'> {
  const media = hero.backgroundMedia?.trim() ?? '';
  let video = hero.backgroundVideo?.trim() ?? '';
  let image = hero.backgroundImage?.trim() ?? '';

  // A video URL accidentally stored in the image/poster slot belongs to video.
  if (isVideoUrl(image)) {
    if (!video) video = image;
    image = '';
  }

  if (media) {
    if (isVideoUrl(media)) {
      if (!video) video = media;
    } else {
      image = media;
    }
  }

  return { backgroundMedia: '', backgroundImage: image, backgroundVideo: video };
}

/**
 * Resolve hero media with the video → image fallback, while staying compatible
 * with rows saved before the split (`backgroundMedia` still wins when present).
 *
 * 视频的封面存在 `backgroundImage` 里，同时充当移动端/视频加载前的退避背景图，
 * 所以 video 场景下 `image` 与 `poster` 相同。
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
