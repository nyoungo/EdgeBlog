/** zod schemas validating each settings namespace on write. */
import { z } from 'zod';
import { SETTING_NAMESPACES, type SettingNamespace } from '@shared/settings-defaults';

const urlOrPath = z.string().trim().max(1000);

export const siteSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    tagline: z.string().trim().max(160),
    description: z.string().trim().max(400),
    logo: z.object({
      type: z.enum(['text', 'image']),
      text: z.string().max(40),
      imageUrl: urlOrPath,
    }),
    favicon: urlOrPath,
    footerText: z.string().max(300),
    footerLinks: z
      .array(z.object({ label: z.string().max(40), href: urlOrPath }))
      .max(10),
    locale: z.string().max(20),
  })
  .deepPartial();

export const themeSchema = z
  .object({
    preset: z.enum(['ink', 'midnight', 'solar', 'seasaltt', 'forest', 'cyber']),
    mode: z.enum(['light', 'dark', 'system']),
    primaryColor: z.string().trim().max(32),
    backgroundColor: z.string().trim().max(32),
    fontBody: z.enum(['sans', 'serif']),
    fontHeading: z.enum(['sans', 'serif']),
    fontScale: z.enum(['sm', 'md', 'lg']),
    radius: z.enum(['none', 'sm', 'md', 'lg']),
    maxWidth: z.string().trim().max(12),
    lineHeight: z.enum(['compact', 'normal', 'relaxed']),
    codeTheme: z.string().trim().max(60),
  })
  .deepPartial();

const homeModule = z.object({
  id: z.enum(['hero', 'latest', 'featured', 'tags', 'newsletter']),
  enabled: z.boolean(),
});

const heroSchema = z.object({
  width: z.enum(['contained', 'narrow', 'full']),
  height: z.string().trim().max(20),
  fullScreen: z.boolean(),
  background: z.string().trim().max(200),
  backgroundImage: z.string().trim().max(1000),
  overlayLight: z.number().min(0).max(1),
  overlayDark: z.number().min(0).max(1),
  textColor: z.string().trim().max(60),
  textMutedColor: z.string().trim().max(60),
  align: z.enum(['left', 'center']),
});

const headerSchema = z.object({
  position: z.enum(['static', 'sticky', 'fixed', 'left']),
  style: z.enum(['default', 'minimal', 'pill']),
  background: z.enum(['solid', 'glass', 'transparent']),
  transparentOnTop: z.boolean(),
  height: z.string().trim().max(20),
  align: z.enum(['left', 'center', 'right']),
});

export const layoutSchema = z
  .object({
    homeModules: z.array(homeModule).max(10),
    sidebar: z.enum(['left', 'right', 'none']),
    cardStyle: z.enum(['magazine', 'minimal', 'grid', 'overlay', 'compact']),
    cardSize: z.enum(['sm', 'md', 'lg']),
    cardBlur: z.enum(['none', 'sm', 'md', 'lg']),
    postsPerPage: z.number().int().min(1).max(50),
    hero: heroSchema,
    header: headerSchema,
  })
  .deepPartial();

const navItem = z.object({
  id: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(40),
  href: z.string().trim().min(1).max(1000),
  external: z.boolean(),
  newTab: z.boolean(),
});

const socialItem = z.object({
  id: z.string().trim().min(1).max(60),
  type: z.enum([
    'github',
    'x',
    'email',
    'rss',
    'mastodon',
    'bluesky',
    'linkedin',
    'youtube',
    'wechat',
    'link',
  ]),
  label: z.string().trim().min(1).max(40),
  url: z.string().trim().min(1).max(1000),
});

export const navigationSchema = z.array(navItem).max(20);
export const socialSchema = z.array(socialItem).max(20);

export const featuresSchema = z
  .object({
    comments: z.boolean(),
    search: z.boolean(),
    rss: z.boolean(),
    views: z.boolean(),
    viewTransitions: z.boolean(),
    toc: z.boolean(),
    backToTop: z.boolean(),
    newsletter: z.boolean(),
    relatedPosts: z.boolean(),
    prevNext: z.boolean(),
  })
  .deepPartial();

export const advancedSchema = z
  .object({
    customCss: z.string().max(50_000),
    headHtml: z.string().max(20_000),
    footerHtml: z.string().max(20_000),
    analytics: z.object({
      provider: z.enum(['none', 'plausible', 'umami', 'ga4']),
      token: z.string().max(200),
    }),
  })
  .deepPartial();

export const commentsSchema = z
  .object({
    requireModeration: z.boolean(),
    allowGuests: z.boolean(),
    maxDepth: z.number().int().min(0).max(5),
    rateLimitSeconds: z.number().int().min(5).max(3600),
    minLength: z.number().int().min(1).max(100),
    maxLength: z.number().int().min(10).max(10_000),
  })
  .deepPartial();

export const pagesSchema = z
  .object({
    about: z.object({
      title: z.string().trim().min(1).max(120),
      contentMd: z.string().max(200_000),
      updatedAt: z.string().max(40),
    }),
  })
  .deepPartial();

const musicTrack = z.object({
  id: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(200),
  artist: z.string().trim().max(200).optional(),
  cover: z.string().trim().max(1000).optional(),
  src: z.string().trim().min(1).max(2000),
});

export const musicSchema = z
  .object({
    enabled: z.boolean(),
    language: z.enum(['zh', 'en']),
    mode: z.enum(['cloud', 'local']),
    apiUrl: z.string().trim().max(1000),
    playlist: z.array(musicTrack).max(200),
    theme: z.string().trim().max(80),
    playerWidth: z.string().trim().max(20),
    bottom: z.string().trim().max(20),
    songListHeight: z.string().trim().max(20),
    visibleSongListCount: z.number().int().min(1).max(20),
    volume: z.number().min(0).max(1),
    playMode: z.enum(['order', 'single', 'random']),
    isAutoPopup: z.boolean(),
    isAutoPlaylist: z.boolean(),
    colorfulLyric: z.boolean(),
    audioVisualizer: z.boolean(),
    rememberPlayback: z.boolean(),
  })
  .deepPartial();

/** namespace -> write-time validator */
export const SETTINGS_SCHEMAS: Record<SettingNamespace, z.ZodTypeAny> = {
  site: siteSchema,
  theme: themeSchema,
  layout: layoutSchema,
  navigation: navigationSchema,
  social: socialSchema,
  features: featuresSchema,
  advanced: advancedSchema,
  comments: commentsSchema,
  pages: pagesSchema,
  music: musicSchema,
};

export function isNamespace(value: string): value is SettingNamespace {
  return (SETTING_NAMESPACES as readonly string[]).includes(value);
}
