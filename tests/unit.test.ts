import { describe, expect, it } from 'vitest';
import { qs } from '../src/lib/api';
import {
  formatNumber,
  mediaKeyFromUrl,
  parseSqlDate,
  relativeTime,
} from '../src/lib/format';
import { clamp } from '../src/lib/utils';
import { DEFAULT_SETTINGS, SETTING_NAMESPACES, defaultFor } from '../shared/settings-defaults';

describe('parseSqlDate', () => {
  it('reads SQLite timestamps as UTC', () => {
    const date = parseSqlDate('2026-01-02 03:04:05');
    expect(date?.toISOString()).toBe('2026-01-02T03:04:05.000Z');
  });

  it('accepts full ISO instants unchanged', () => {
    const date = parseSqlDate('2026-01-02T03:04:05Z');
    expect(date?.toISOString()).toBe('2026-01-02T03:04:05.000Z');
  });

  it('returns null for missing or unparseable input', () => {
    expect(parseSqlDate(null)).toBeNull();
    expect(parseSqlDate('')).toBeNull();
    expect(parseSqlDate('not a date')).toBeNull();
  });
});

describe('formatNumber', () => {
  it('keeps small numbers exact and compacts the rest', () => {
    expect(formatNumber(999)).toBe('999');
    expect(formatNumber(1000)).toBe('1.0k');
    expect(formatNumber(10_000)).toBe('10k');
    expect(formatNumber(1_234_567)).toBe('1.2M');
  });

  it('treats nullish values as zero', () => {
    expect(formatNumber(undefined)).toBe('0');
    expect(formatNumber(null)).toBe('0');
  });
});

describe('relativeTime', () => {
  it('falls back to an empty string for bad input', () => {
    expect(relativeTime(null)).toBe('');
    expect(relativeTime('nope')).toBe('');
  });
});

describe('mediaKeyFromUrl', () => {
  it('reduces absolute, relative and bare URLs to a storage key', () => {
    expect(mediaKeyFromUrl('https://cdn.example.com/media/uploads/a.png')).toBe('uploads/a.png');
    expect(mediaKeyFromUrl('/media/uploads/b.png')).toBe('uploads/b.png');
    expect(mediaKeyFromUrl('uploads/c.png')).toBe('uploads/c.png');
  });
});

describe('qs', () => {
  it('drops empty values and encodes the rest', () => {
    expect(qs({})).toBe('');
    expect(qs({ a: 1, b: '', c: undefined, d: null, e: 'x y' })).toBe('?a=1&e=x+y');
  });
});

describe('clamp', () => {
  it('bounds a value to the range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe('settings defaults', () => {
  it('covers every declared namespace', () => {
    for (const ns of SETTING_NAMESPACES) {
      expect(DEFAULT_SETTINGS[ns]).toBeDefined();
    }
  });

  it('hands out fresh copies so edits never mutate the defaults', () => {
    const first = defaultFor('site');
    first.name = 'mutated';
    expect(defaultFor('site').name).not.toBe('mutated');
  });
});
