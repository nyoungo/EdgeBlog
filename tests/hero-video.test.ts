import { describe, expect, it } from 'vitest';
import {
  VIDEO_SWAP_LEAD_SECONDS,
  initialVideoTime,
  needsSecondDeck,
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

describe('needsSecondDeck', () => {
  it('uses a single deck for a full-clip loop', () => {
    expect(needsSecondDeck(true, 0, 0)).toBe(false);
  });

  it('uses a single deck when looping is off, even with a range', () => {
    expect(needsSecondDeck(false, 4, 12)).toBe(false);
    expect(needsSecondDeck(false, 0, 0)).toBe(false);
  });

  it('uses a second deck for a looping sub-range', () => {
    expect(needsSecondDeck(true, 4, 12)).toBe(true);
    expect(needsSecondDeck(true, 0, 12)).toBe(true);
    expect(needsSecondDeck(true, 4, 0)).toBe(true);
  });

  it('uses a single deck for empty or inverted ranges that fall back to the clip', () => {
    expect(needsSecondDeck(true, 12, 12)).toBe(false);
    expect(needsSecondDeck(true, 12, 10)).toBe(false);
    expect(needsSecondDeck(true, 0, -1)).toBe(false);
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
