import { describe, expect, it } from 'vitest';
import {
  keyFromPublicUrl,
  parseByteRange,
  sniffImageMime,
  sniffMediaMime,
  sniffVideoMime,
  thumbnailKey,
} from '../functions/lib/media-file';
import { normalizeVideoRange } from '../src/lib/hero-video';

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

describe('media MIME sniffing', () => {
  it('recognises the supported image formats', () => {
    expect(sniffImageMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffImageMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
    expect(sniffImageMime(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe('image/gif');
    expect(sniffImageMime(bytes(0x42, 0x4d, 0x00, 0x00))).toBe('image/bmp');
    expect(
      sniffImageMime(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50)),
    ).toBe('image/webp');
  });

  it('does not mistake AVIF images for MP4 video', () => {
    const avif = bytes(0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66);
    expect(sniffImageMime(avif)).toBe('image/avif');
    expect(sniffVideoMime(avif)).toBeNull();
    expect(sniffMediaMime(avif)).toBe('image/avif');
  });

  it('recognises MP4 and WebM video', () => {
    const mp4 = bytes(0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d);
    expect(sniffVideoMime(mp4)).toBe('video/mp4');
    expect(sniffMediaMime(mp4)).toBe('video/mp4');

    const webm = bytes(0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x82, 0x84);
    expect(sniffVideoMime(webm)).toBe('video/webm');
    expect(sniffMediaMime(webm)).toBe('video/webm');
  });

  it('rejects unknown payloads', () => {
    expect(sniffMediaMime(bytes(0x3c, 0x68, 0x74, 0x6d, 0x6c))).toBeNull();
  });
});

describe('parseByteRange', () => {
  it('parses closed, open-ended and suffix ranges', () => {
    expect(parseByteRange('bytes=0-9', 100)).toEqual({ offset: 0, length: 10 });
    expect(parseByteRange('bytes=90-', 100)).toEqual({ offset: 90, length: 10 });
    expect(parseByteRange('bytes=-10', 100)).toEqual({ offset: 90, length: 10 });
    expect(parseByteRange('bytes=0-999', 100)).toEqual({ offset: 0, length: 100 });
  });

  it('rejects unsatisfiable, inverted and multi ranges', () => {
    expect(parseByteRange('bytes=100-200', 100)).toBeNull();
    expect(parseByteRange('bytes=20-10', 100)).toBeNull();
    expect(parseByteRange('bytes=0-1,5-6', 100)).toBeNull();
    expect(parseByteRange(null, 100)).toBeNull();
    expect(parseByteRange('bytes=0-10', 0)).toBeNull();
  });
});

describe('video thumbnails', () => {
  it('stores the cover next to the video with a -thumb suffix', () => {
    expect(thumbnailKey('uploads/2026/11/hero-abc.mp4', 'image/jpeg')).toBe(
      'uploads/2026/11/hero-abc-thumb.jpg',
    );
    expect(thumbnailKey('uploads/2026/11/hero-abc.webm', 'image/webp')).toBe(
      'uploads/2026/11/hero-abc-thumb.webp',
    );
  });

  it('maps a public URL back to its R2 key', () => {
    expect(keyFromPublicUrl('/media/uploads/2026/11/hero-abc-thumb.jpg')).toBe(
      'uploads/2026/11/hero-abc-thumb.jpg',
    );
    expect(keyFromPublicUrl('https://cdn.example.com/uploads/a.jpg', 'https://cdn.example.com')).toBe(
      'uploads/a.jpg',
    );
  });

  it('refuses URLs outside the media prefix or with traversal', () => {
    expect(keyFromPublicUrl('https://other.example/a.jpg')).toBeNull();
    expect(keyFromPublicUrl('/media/../secret')).toBeNull();
    expect(keyFromPublicUrl('/media/')).toBeNull();
  });
});

describe('normalizeVideoRange', () => {
  it('keeps a valid custom loop window', () => {
    expect(normalizeVideoRange(30, 5, 12)).toEqual({ start: 5, end: 12 });
  });

  it('treats end = 0 as the end of the clip', () => {
    expect(normalizeVideoRange(30, 5, 0)).toEqual({ start: 5, end: 30 });
    expect(normalizeVideoRange(30, 0, 0)).toEqual({ start: 0, end: 30 });
  });

  it('clamps an end time beyond the clip duration', () => {
    expect(normalizeVideoRange(30, 5, 99)).toEqual({ start: 5, end: 30 });
  });

  it('falls back to the whole clip for inverted or empty ranges', () => {
    expect(normalizeVideoRange(30, 12, 5)).toEqual({ start: 0, end: 30 });
    expect(normalizeVideoRange(30, 30, 30)).toEqual({ start: 0, end: 30 });
    expect(normalizeVideoRange(30, -5, 10)).toEqual({ start: 0, end: 10 });
  });
});
