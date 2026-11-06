import type { PublicSettings, ThemeMode, ThemeSettings } from '@shared/types';
import { brandShades, hexToRgbChannels, parseChannels } from './color';
import { codeThemeCss } from './code-themes';
import { injectInto } from './dom-inject';

export { hexToRgbChannels } from './color';

const MODE_KEY = 'eb:mode';
const THEME_KEY = 'eb:theme';

const FONT_SIZE: Record<ThemeSettings['fontScale'], string> = {
  sm: '15px',
  md: '17px',
  lg: '19px',
};

export const RADIUS: Record<ThemeSettings['radius'], string> = {
  none: '0px',
  sm: '8px',
  md: '12px',
  lg: '16px',
};

const LINE_HEIGHT: Record<ThemeSettings['lineHeight'], string> = {
  compact: '1.6',
  normal: '1.75',
  relaxed: '1.9',
};

const SANS_STACK = [
  '-apple-system',
  'BlinkMacSystemFont',
  "'Segoe UI'",
  "'PingFang SC'",
  "'Hiragino Sans GB'",
  "'Microsoft YaHei'",
  "'Noto Sans SC'",
  'system-ui',
  'sans-serif',
].join(', ');

const SERIF_STACK = [
  "'Songti SC'",
  "'Noto Serif SC'",
  "'Source Han Serif SC'",
  'Georgia',
  "'Times New Roman'",
  'serif',
].join(', ');

const MONO_STACK = [
  'ui-monospace',
  "'SFMono-Regular'",
  "'SF Mono'",
  'Menlo',
  'Consolas',
  "'Liberation Mono'",
  'monospace',
].join(', ');

const FONT_STACKS: Record<ThemeSettings['fontBody'], string> = {
  sans: SANS_STACK,
  serif: SERIF_STACK,
  mono: MONO_STACK,
};

export const BACKGROUND_LAYOUT: Record<
  ThemeSettings['backgroundLayout'],
  { size: string; repeat: string; position: string }
> = {
  cover: { size: 'cover', repeat: 'no-repeat', position: 'center' },
  contain: { size: 'contain', repeat: 'no-repeat', position: 'center' },
  center: { size: 'auto', repeat: 'no-repeat', position: 'center' },
  tile: { size: 'auto', repeat: 'repeat', position: 'left top' },
  'repeat-x': { size: 'auto', repeat: 'repeat-x', position: 'center top' },
  'repeat-y': { size: 'auto', repeat: 'repeat-y', position: 'center top' },
};

/** Quote a URL for safe use inside a CSS `url()` token. */
function cssUrl(value: string): string {
  const clean = value.replace(/[\r\n]+/g, '').replace(/"/g, '%22');
  return `url("${clean}")`;
}

/**
 * Global page background image: published as CSS variables consumed by `body`
 * (see styles/globals.css). `--eb-bg-scrim` paints a theme-tinted layer above
 * the image so foreground text keeps its contrast.
 */
function applyBackground(theme: ThemeSettings, style: CSSStyleDeclaration): void {
  const url = theme.backgroundImage?.trim();
  if (!url) {
    for (const prop of [
      '--eb-bg-image',
      '--eb-bg-size',
      '--eb-bg-repeat',
      '--eb-bg-position',
      '--eb-bg-attachment',
      '--eb-bg-scrim',
    ]) {
      style.removeProperty(prop);
    }
    return;
  }

  const layout = BACKGROUND_LAYOUT[theme.backgroundLayout] ?? BACKGROUND_LAYOUT.cover;
  style.setProperty('--eb-bg-image', cssUrl(url));
  style.setProperty('--eb-bg-size', layout.size);
  style.setProperty('--eb-bg-repeat', layout.repeat);
  style.setProperty('--eb-bg-position', layout.position);
  style.setProperty(
    '--eb-bg-attachment',
    theme.backgroundAttachment === 'scroll' ? 'scroll' : 'fixed',
  );
  style.setProperty('--eb-bg-scrim', String(Math.min(0.9, Math.max(0, theme.backgroundScrim ?? 0))));
}

export function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveDark(mode: ThemeMode): boolean {
  return mode === 'dark' || (mode === 'system' && prefersDark());
}

/**
 * Split the legacy single `backgroundColor` (which only ever affected light
 * mode) into the two independent fields. The legacy value is cleared so it
 * cannot keep overriding the light background after the split.
 */
export function normalizeThemeBackground(
  theme: Pick<ThemeSettings, 'backgroundColor' | 'backgroundColorLight' | 'backgroundColorDark'>,
): Pick<ThemeSettings, 'backgroundColor' | 'backgroundColorLight' | 'backgroundColorDark'> {
  const legacy = theme.backgroundColor?.trim() ?? '';
  return {
    backgroundColor: '',
    backgroundColorLight: theme.backgroundColorLight?.trim() || legacy,
    backgroundColorDark: theme.backgroundColorDark?.trim() ?? '',
  };
}

function injectStyle(id: string, css: string): void {
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!css) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = css;
}

/**
 * Apply a full theme to the document. Everything is expressed as CSS custom
 * properties / data attributes so no Tailwind recompilation is required.
 */
export function applyTheme(theme: ThemeSettings): void {
  const root = document.documentElement;
  const style = root.style;
  const dark = resolveDark(theme.mode);

  root.dataset.theme = theme.preset;
  root.dataset.mode = dark ? 'dark' : 'light';

  // 自定义主色：同时派生前景色与 hover/active，避免白字压浅色导致不可读。
  // 没有自定义主色时，从当前预设解析出实际主色，派生规则保持一致。
  const custom = theme.primaryColor ? hexToRgbChannels(theme.primaryColor) : null;
  if (custom) style.setProperty('--c-brand', custom);
  else style.removeProperty('--c-brand');

  // 必须读计算值：预设的主色定义在样式表里，内联覆盖移除后才拿得到。
  const effective =
    custom ?? getComputedStyle(root).getPropertyValue('--c-brand').trim();
  const brandRgb = parseChannels(effective);
  if (brandRgb) {
    const shades = brandShades(brandRgb, dark);
    style.setProperty('--c-brand-fg', shades.fg);
    style.setProperty('--c-brand-hover', shades.hover);
    style.setProperty('--c-brand-active', shades.active);
  } else {
    for (const prop of ['--c-brand-fg', '--c-brand-hover', '--c-brand-active']) {
      style.removeProperty(prop);
    }
  }

  // 亮/暗背景分别配置；旧字段 `backgroundColor` 仅作为浅色模式的回退值。
  const bgHex = dark
    ? theme.backgroundColorDark
    : theme.backgroundColorLight || theme.backgroundColor;
  const bg = bgHex ? hexToRgbChannels(bgHex) : null;
  if (bg) style.setProperty('--c-bg', bg);
  else style.removeProperty('--c-bg');

  style.setProperty('--radius', RADIUS[theme.radius] ?? RADIUS.md);
  style.setProperty('--max-width', theme.maxWidth || '72ch');
  style.setProperty('--font-size-base', FONT_SIZE[theme.fontScale] ?? FONT_SIZE.md);
  style.setProperty('--line-height', LINE_HEIGHT[theme.lineHeight] ?? LINE_HEIGHT.normal);
  style.setProperty('--font-body', FONT_STACKS[theme.fontBody] ?? SANS_STACK);
  style.setProperty('--font-heading', FONT_STACKS[theme.fontHeading] ?? SANS_STACK);

  applyBackground(theme, style);

  injectStyle('eb-code-theme', codeThemeCss(theme.codeTheme));
}

/** Apply site-wide advanced settings (custom CSS, injected head/footer HTML). */
export function applyAdvanced(advanced: PublicSettings['advanced']): void {
  injectStyle('eb-custom-css', advanced.customCss ?? '');
  injectInto(document.head, advanced.headHtml ?? '');

  // Analytics is loaded once, only when a provider + token are configured.
  const { provider, token } = advanced.analytics ?? { provider: 'none', token: '' };
  if (provider === 'none' || !token || document.getElementById('eb-analytics')) return;
  const script = document.createElement('script');
  script.id = 'eb-analytics';
  script.defer = true;
  if (provider === 'plausible') {
    script.src = 'https://plausible.io/js/script.js';
    script.dataset.domain = token;
  } else if (provider === 'umami') {
    script.src = token;
  } else if (provider === 'ga4') {
    script.src = `https://www.googletagmanager.com/gtag/js?id=${token}`;
    const inline = document.createElement('script');
    inline.textContent = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${token}');`;
    document.head.appendChild(inline);
  }
  document.head.appendChild(script);
}

/** Persist the user's manual mode/preset so the pre-paint script can restore it. */
export function persistMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* storage unavailable */
  }
}

export function persistTheme(preset: string): void {
  try {
    localStorage.setItem(THEME_KEY, preset);
  } catch {
    /* storage unavailable */
  }
}

export function readStoredMode(): ThemeMode | null {
  try {
    const value = localStorage.getItem(MODE_KEY);
    return value === 'light' || value === 'dark' || value === 'system' ? value : null;
  } catch {
    return null;
  }
}
