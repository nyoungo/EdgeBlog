/**
 * Pure colour helpers shared by the theme engine and the admin preview.
 *
 * Everything speaks "space separated RGB channels" (`"99 102 241"`) because the
 * whole design system stores colours as raw channels so Tailwind can append an
 * alpha value (`rgb(var(--c-brand) / 0.2)`).
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Convert `#rrggbb` (or `#rgb`) to channels; returns null for anything else. */
export function hexToRgb(hex: string): Rgb | null {
  const value = hex.trim().replace(/^#/, '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function rgbToChannels({ r, g, b }: Rgb): string {
  return `${Math.round(r)} ${Math.round(g)} ${Math.round(b)}`;
}

/** Convert `#rrggbb` (or `#rgb`) to a space-separated RGB channel triple. */
export function hexToRgbChannels(hex: string): string | null {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToChannels(rgb) : null;
}

/** Parse a channel triple such as `"99 102 241"` back into numbers. */
export function parseChannels(channels: string): Rgb | null {
  const parts = channels.trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [r, g, b] = parts as [number, number, number];
  return { r, g, b };
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (value: number) => {
    const s = Math.min(255, Math.max(0, value)) / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two luminances (1–21). */
export function contrastRatio(a: number, b: number): number {
  const light = Math.max(a, b);
  const dark = Math.min(a, b);
  return (light + 0.05) / (dark + 0.05);
}

/** Near-black used for brand foregrounds when white would be unreadable. */
const INK: Rgb = { r: 17, g: 24, b: 39 };

/**
 * Pick a readable foreground for text placed on `background`.
 *
 * Prefers white (the conventional look on saturated buttons) as long as it
 * reaches the WCAG AA large-text ratio; otherwise falls back to near-black.
 * This keeps an arbitrary custom primary colour readable instead of always
 * painting white text on it.
 */
export function readableForeground(background: Rgb): string {
  const bgLum = relativeLuminance(background);
  const whiteRatio = contrastRatio(bgLum, 1);
  if (whiteRatio >= 4.5) return '255 255 255';
  const inkRatio = contrastRatio(bgLum, relativeLuminance(INK));
  return inkRatio > whiteRatio ? rgbToChannels(INK) : '255 255 255';
}

/** Linear blend in sRGB space (good enough for small hover deltas). */
export function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  const t = Math.min(1, Math.max(0, amount));
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

export interface BrandShades {
  fg: string;
  hover: string;
  active: string;
}

/**
 * Derive the foreground plus hover/active shades for a brand colour.
 * Hover darkens on light surfaces and lightens on dark surfaces, so the
 * interaction reads as "pressed in" in both modes.
 */
export function brandShades(brand: Rgb, dark: boolean): BrandShades {
  const target: Rgb = dark ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
  return {
    fg: readableForeground(brand),
    hover: rgbToChannels(mix(brand, target, dark ? 0.12 : 0.1)),
    active: rgbToChannels(mix(brand, target, dark ? 0.24 : 0.2)),
  };
}