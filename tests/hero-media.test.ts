import { describe, expect, it } from 'vitest';
import { isVideoUrl, resolveHeroMedia } from '../src/lib/hero-media';

describe('isVideoUrl', () => {
  it('recognises video extensions case-insensitively', () => {
    expect(isVideoUrl('https://cdn.example/hero.mp4')).toBe(true);
    expect(isVideoUrl('https://cdn.example/hero.MP4')).toBe(true);
    expect(isVideoUrl('/media/uploads/2026/11/hero-WEBM.webm')).toBe(true);
    expect(isVideoUrl('https://cdn.example/hero.m4v?token=1#t=2')).toBe(true);
  });

  it('treats image and extension-less URLs as non-video', () => {
    expect(isVideoUrl('https://cdn.example/hero.jpg')).toBe(false);
    expect(isVideoUrl('/media/uploads/2026/11/hero-abc123')).toBe(false);
    expect(isVideoUrl('')).toBe(false);
  });
});

describe('resolveHeroMedia', () => {
  const empty = { backgroundMedia: '', backgroundImage: '', backgroundVideo: '' };

  it('uses the unified media field for images and videos', () => {
    expect(resolveHeroMedia({ ...empty, backgroundMedia: '/media/a.jpg' })).toMatchObject({
      kind: 'image',
      image: '/media/a.jpg',
      video: '',
    });
    expect(resolveHeroMedia({ ...empty, backgroundMedia: '/media/a.mp4' })).toMatchObject({
      kind: 'video',
      image: '',
      video: '/media/a.mp4',
      poster: '',
    });
  });

  it('uses the saved cover image as the video poster and fallback background', () => {
    expect(
      resolveHeroMedia({ ...empty, backgroundMedia: '/media/hero.mp4', backgroundImage: '/media/hero-thumb.jpg' }),
    ).toMatchObject({
      kind: 'video',
      value: '/media/hero.mp4',
      video: '/media/hero.mp4',
      image: '/media/hero-thumb.jpg',
      poster: '/media/hero-thumb.jpg',
    });
  });

  it('ignores a video URL mistakenly stored as the poster', () => {
    expect(
      resolveHeroMedia({ ...empty, backgroundMedia: '/media/hero.mp4', backgroundImage: '/media/other.mp4' }),
    ).toMatchObject({ kind: 'video', image: '', poster: '' });
  });

  it('falls back to the legacy video + image fields', () => {
    expect(
      resolveHeroMedia({
        backgroundMedia: '',
        backgroundImage: '/media/poster.jpg',
        backgroundVideo: '/media/hero.mp4',
      }),
    ).toMatchObject({
      kind: 'video',
      value: '/media/hero.mp4',
      image: '/media/poster.jpg',
      video: '/media/hero.mp4',
      poster: '/media/poster.jpg',
    });
  });

  it('uses the legacy image when no video exists', () => {
    expect(
      resolveHeroMedia({ backgroundMedia: '', backgroundImage: '/media/cover.png', backgroundVideo: '' }),
    ).toMatchObject({ kind: 'image', value: '/media/cover.png', image: '/media/cover.png', video: '' });
  });
});
