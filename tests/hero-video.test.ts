import { describe, expect, it } from 'vitest';
import {
  VIDEO_SWAP_LEAD_SECONDS,
  initialVideoTime,
  normalizeVideoRange,
  videoSwapLead,
} from '../src/lib/hero-video';

describe('normalizeVideoRange', () => {
  it('treats end = 0 as the clip end and clamps past-duration values', () => {
    expect(normalizeVideoRange(20, 8, 0)).toEqual({ start: 8, end: 20 });
    expect(normalizeVideoRange(20, 8, 25)).toEqual({ start: 8, end: 20 });
  });

  it('falls back to the whole clip for empty or inverted windows', () => {
    expect(normalizeVideoRange(20, 12, 10)).toEqual({ start: 0, end: 20 });
    expect(normalizeVideoRange(20, 12, 12)).toEqual({ start: 0, end: 20 });
    expect(normalizeVideoRange(20, 8, -1)).toEqual({ start: 8, end: 20 });
  });
});

describe('initialVideoTime', () => {
  const range = { start: 8, end: 20.7666 };

  it('starts the first pass at the clip head when requested', () => {
    expect(initialVideoTime(range, true)).toBe(0);
  });

  it('enters the loop range immediately when the intro should be skipped', () => {
    expect(initialVideoTime(range, false)).toBe(8);
  });
});

describe('videoSwapLead', () => {
  it('never probes more than two 60 fps frames early', () => {
    expect(videoSwapLead({ start: 0, end: 20 })).toBe(VIDEO_SWAP_LEAD_SECONDS);
    expect(VIDEO_SWAP_LEAD_SECONDS).toBeLessThanOrEqual(0.04);
  });

  it('keeps at least a quarter of a very short range visible', () => {
    expect(videoSwapLead({ start: 4, end: 4.08 })).toBeCloseTo(0.02, 5);
    expect(videoSwapLead({ start: 4, end: 4 })).toBe(0);
  });
});
