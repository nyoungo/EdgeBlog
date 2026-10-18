/**
 * Dynamically generated site icon.
 *
 * The tab icon follows the runtime configuration instead of a static file:
 * the accent comes from `theme.primaryColor` (or the active preset) and the
 * glyph is the first letter of the brand name. `site.favicon` overrides the
 * whole thing — when it is set the shell links straight to that image and this
 * generator is bypassed.
 */
import type { PublicSettings } from '@shared/types';

/** Accent channel triples per preset — mirrors `src/styles/tokens.css`. */
const PRESET_BRAND: Record<string, string> = {
  ink: '99 102 241',
  midnight: '59 130 246',
  solar: '234 88 12',
  seasaltt: '13 148 136',
  forest: '22 163 74',
  cyber: '217 70 239',
};

const FALLBACK_BRAND = '99 102 241';

const HEX6 = /^#?([0-9a-f]{6})$/i;
const HEX3 = /^#?([0-9a-f]{3})$/i;

/** `#6366f1` / `#63f` -> `"99 102 241"`. Returns null for anything else. */
export function toChannels(value: string | undefined | null): string | null {
  if (!value) return null;
  const text = value.trim();

  const long = text.match(HEX6);
  if (long?.[1]) {
    const h = long[1];
    return `${parseInt(h.slice(0, 2), 16)} ${parseInt(h.slice(2, 4), 16)} ${parseInt(h.slice(4, 6), 16)}`;
  }

  const short = text.match(HEX3);
  if (short?.[1]) {
    const [r, g, b] = short[1].split('') as [string, string, string];
    return `${parseInt(r + r, 16)} ${parseInt(g + g, 16)} ${parseInt(b + b, 16)}`;
  }

  return null;
}

function mix(channels: string, toward: number, amount: number): string {
  return channels
    .split(' ')
    .map((c) => Math.round(Number(c) + (toward - Number(c)) * amount))
    .join(' ');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** First visible character of the brand name (upper-cased for latin scripts). */
export function brandInitial(settings: PublicSettings): string {
  const raw = (settings.site.logo.text || settings.site.name || 'E').trim();
  const first = Array.from(raw)[0] ?? 'E';
  return first.toUpperCase();
}

/** SVG favicon: rounded square in the brand accent with the site initial. */
export function renderFaviconSvg(settings: PublicSettings): string {
  const base =
    toChannels(settings.theme.primaryColor) ?? PRESET_BRAND[settings.theme.preset] ?? FALLBACK_BRAND;
  const lighter = mix(base, 255, 0.28);
  const letter = escapeXml(brandInitial(settings));
  const label = escapeXml(settings.site.name || 'Blog');
  const rgb = (c: string) => `rgb(${c.split(' ').join(',')})`;

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img"',
    ` aria-label="${label}">`,
    `<title>${label}</title>`,
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">',
    `<stop offset="0" stop-color="${rgb(base)}"/>`,
    `<stop offset="1" stop-color="${rgb(lighter)}"/>`,
    '</linearGradient></defs>',
    '<rect width="64" height="64" rx="14" fill="url(#g)"/>',
    '<text x="32" y="33" text-anchor="middle" dominant-baseline="central"',
    ' font-family="system-ui,-apple-system,\'Segoe UI\',Roboto,\'PingFang SC\',\'Microsoft YaHei\',sans-serif"',
    ` font-size="34" font-weight="700" fill="#ffffff">${letter}</text>`,
    '</svg>',
  ].join('');
}
