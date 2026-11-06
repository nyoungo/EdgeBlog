import { describe, expect, it } from 'vitest';
import {
  brandShades,
  contrastRatio,
  hexToRgb,
  hexToRgbChannels,
  mix,
  parseChannels,
  readableForeground,
  relativeLuminance,
} from '../src/lib/color';
import { normalizeThemeBackground } from '../src/lib/theme';

describe('hexToRgbChannels', () => {
  it('expands shorthand and keeps long form', () => {
    expect(hexToRgbChannels('#fff')).toBe('255 255 255');
    expect(hexToRgbChannels('#6366F1')).toBe('99 102 241');
    expect(hexToRgbChannels('6366f1')).toBe('99 102 241');
  });

  it('rejects invalid values', () => {
    expect(hexToRgbChannels('')).toBeNull();
    expect(hexToRgbChannels('#12345')).toBeNull();
    expect(hexToRgbChannels('rebeccapurple')).toBeNull();
    expect(hexToRgbChannels('rgb(1,2,3)')).toBeNull();
  });
});

describe('relativeLuminance / contrastRatio', () => {
  it('anchors black and white', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 5);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
    expect(contrastRatio(0, 1)).toBeCloseTo(21, 5);
    expect(contrastRatio(0.5, 0.5)).toBeCloseTo(1, 5);
  });
});

describe('readableForeground', () => {
  it('keeps white on a saturated brand colour', () => {
    const indigo = hexToRgb('#4f46e5')!;
    expect(readableForeground(indigo)).toBe('255 255 255');
  });

  it('switches to dark text on light brand colours', () => {
    const yellow = hexToRgb('#facc15')!;
    expect(readableForeground(yellow)).toBe('17 24 39');
  });

  it('always returns the higher-contrast option', () => {
    for (const hex of ['#4f46e5', '#facc15', '#0d9488', '#e11d48', '#ffffff', '#000000']) {
      const rgb = hexToRgb(hex)!;
      const fg = parseChannels(readableForeground(rgb))!;
      const chosen = contrastRatio(relativeLuminance(rgb), relativeLuminance(fg));
      const white = contrastRatio(relativeLuminance(rgb), 1);
      const ink = contrastRatio(relativeLuminance(rgb), relativeLuminance({ r: 17, g: 24, b: 39 }));
      expect(chosen).toBeCloseTo(Math.max(white, ink), 5);
    }
  });
});

describe('brandShades', () => {
  const brand = hexToRgb('#4f46e5')!;

  it('darkens hover/active in light mode', () => {
    const { hover, active } = brandShades(brand, false);
    const hoverRgb = parseChannels(hover)!;
    const activeRgb = parseChannels(active)!;
    expect(relativeLuminance(hoverRgb)).toBeLessThan(relativeLuminance(brand));
    expect(relativeLuminance(activeRgb)).toBeLessThan(relativeLuminance(hoverRgb));
  });

  it('lightens hover/active in dark mode', () => {
    const { hover, active } = brandShades(brand, true);
    const hoverRgb = parseChannels(hover)!;
    const activeRgb = parseChannels(active)!;
    expect(relativeLuminance(hoverRgb)).toBeGreaterThan(relativeLuminance(brand));
    expect(relativeLuminance(activeRgb)).toBeGreaterThan(relativeLuminance(hoverRgb));
  });
});

describe('mix', () => {
  it('clamps the ratio to 0..1', () => {
    expect(mix({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }, -1)).toEqual({ r: 0, g: 0, b: 0 });
    expect(mix({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }, 2)).toEqual({
      r: 255,
      g: 255,
      b: 255,
    });
  });
});

describe('normalizeThemeBackground', () => {
  it('moves the legacy light background into the light field', () => {
    expect(
      normalizeThemeBackground({
        backgroundColor: '#f5f7ff',
        backgroundColorLight: '',
        backgroundColorDark: '',
      }),
    ).toEqual({ backgroundColor: '', backgroundColorLight: '#f5f7ff', backgroundColorDark: '' });
  });

  it('keeps explicitly configured fields and never lets the legacy value win', () => {
    expect(
      normalizeThemeBackground({
        backgroundColor: '#000000',
        backgroundColorLight: '#ffffff',
        backgroundColorDark: '#111111',
      }),
    ).toEqual({ backgroundColor: '', backgroundColorLight: '#ffffff', backgroundColorDark: '#111111' });
  });

  it('is a no-op on already-normalized settings', () => {
    expect(
      normalizeThemeBackground({
        backgroundColor: '',
        backgroundColorLight: '#ffffff',
        backgroundColorDark: '#111111',
      }),
    ).toEqual({ backgroundColor: '', backgroundColorLight: '#ffffff', backgroundColorDark: '#111111' });
  });
});