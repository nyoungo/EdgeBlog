/**
 * Canonical default settings — the single source of truth for
 *   * merge fallbacks when a `settings` row is missing, and
 *   * the "restore defaults" action in the admin Appearance panel.
 *
 * Values mirror seed/seed.sql. If you change a default here, update the seed
 * too so a fresh database matches a restored one.
 */
import type { AiSettings, PublicSettings } from './types';

export const SETTING_NAMESPACES = [
  'site',
  'theme',
  'layout',
  'navigation',
  'social',
  'features',
  'advanced',
  'comments',
  'pages',
  'music',
] as const;

export type SettingNamespace = (typeof SETTING_NAMESPACES)[number];

export const DEFAULT_SETTINGS: PublicSettings = {
  site: {
    name: 'Edge Blog',
    tagline: '在边缘写作，与世界相连',
    description: '一个部署在 Cloudflare Pages 上的现代化动态博客，React + Hono + D1。',
    logo: { type: 'text', text: 'Edge', imageUrl: '' },
    favicon: '',
    footerText: '© 2026 Edge Blog. 保留所有权利。',
    footerLinks: [
      { label: 'RSS', href: '/rss.xml' },
      { label: 'Sitemap', href: '/sitemap.xml' },
    ],
    locale: 'zh-CN',
  },
  theme: {
    preset: 'ink',
    mode: 'system',
    primaryColor: '',
    backgroundColor: '#f5f7ff',
    backgroundImage: '',
    backgroundLayout: 'cover',
    backgroundAttachment: 'fixed',
    backgroundScrim: 0.35,
    fontBody: 'sans',
    fontHeading: 'sans',
    fontScale: 'md',
    radius: 'md',
    maxWidth: '72ch',
    lineHeight: 'relaxed',
    codeTheme: 'github-dark',
  },
  layout: {
    homeModules: [
      { id: 'hero', enabled: true },
      { id: 'latest', enabled: true },
      { id: 'featured', enabled: true },
      { id: 'tags', enabled: true },
      { id: 'newsletter', enabled: false },
    ],
    sidebar: 'right',
    cardStyle: 'magazine',
    cardSize: 'md',
    cardBlur: 'none',
    postsPerPage: 9,
    hero: {
      width: 'contained',
      height: '',
      fullScreen: false,
      background: '',
      backgroundImage: '',
      overlayLight: 0,
      overlayDark: 0,
      textColor: '',
      textMutedColor: '',
      align: 'left',
    },
    header: {
      position: 'sticky',
      style: 'default',
      background: 'glass',
      transparentOnTop: true,
      height: '64px',
      align: 'center',
    },
  },
  navigation: [
    { id: 'nav-home', label: '首页', href: '/', external: false, newTab: false },
    { id: 'nav-posts', label: '文章', href: '/posts', external: false, newTab: false },
    { id: 'nav-archive', label: '归档', href: '/archive', external: false, newTab: false },
    { id: 'nav-tags', label: '标签', href: '/tags', external: false, newTab: false },
    { id: 'nav-about', label: '关于', href: '/about', external: false, newTab: false },
  ],
  social: [
    { id: 'soc-github', type: 'github', label: 'GitHub', url: 'https://github.com' },
    { id: 'soc-x', type: 'x', label: 'X', url: 'https://x.com' },
    { id: 'soc-email', type: 'email', label: '邮箱', url: 'mailto:hello@example.com' },
    { id: 'soc-rss', type: 'rss', label: 'RSS', url: '/rss.xml' },
  ],
  features: {
    comments: true,
    search: true,
    rss: true,
    views: true,
    viewTransitions: true,
    toc: true,
    backToTop: true,
    newsletter: false,
    relatedPosts: true,
    prevNext: true,
  },
  advanced: {
    customCss: '',
    headHtml: '',
    footerHtml: '',
    analytics: { provider: 'none', token: '' },
  },
  comments: {
    requireModeration: true,
    allowGuests: true,
    maxDepth: 3,
    rateLimitSeconds: 30,
    minLength: 2,
    maxLength: 2000,
  },
  pages: {
    about: {
      title: '关于本站',
      contentMd:
        '## 你好，世界 👋\n\n这里是一个运行在 Cloudflare 边缘网络上的动态博客。\n\n- **前端**：React + TypeScript + Vite + TailwindCSS\n- **后端**：Cloudflare Pages Functions（Hono）\n- **数据**：D1（SQLite）+ R2（对象存储）+ KV（缓存）\n\n全站外观、布局、导航与功能开关都可以在后台的「外观设置」中可视化调整，无需改动代码。\n\n### 联系方式\n\n欢迎通过页脚的社交链接与我联系。',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  },
  music: {
    enabled: false,
    language: 'zh',
    mode: 'cloud',
    apiUrl: 'https://music.api.xfyun.club/api/v1/music/top?platform=netease&topId=3778678',
    playlist: [],
    theme: 'auto-theme',
    playerWidth: '324px',
    bottom: '28px',
    songListHeight: '350px',
    visibleSongListCount: 4,
    volume: 0.8,
    playMode: 'order',
    isAutoPopup: false,
    isAutoPlaylist: false,
    colorfulLyric: false,
    audioVisualizer: false,
    rememberPlayback: true,
  },
};

/** Return the default value for a single namespace (fresh copy, never shared refs). */
export function defaultFor(ns: SettingNamespace): PublicSettings[SettingNamespace] {
  return structuredClone(DEFAULT_SETTINGS[ns]);
}

/* ---------------------------------------------------------------------- ai */

/** Admin-only AI namespace — deliberately excluded from SETTING_NAMESPACES so
 *  the API key never reaches `/api/settings/public`. */
export const AI_NAMESPACE = 'ai';

export const AI_DEFAULTS: AiSettings = {
  enabled: false,
  provider: 'openai',
  baseUrl: '',
  apiKey: '',
  model: 'gpt-4o-mini',
  temperature: 0.7,
  maxTokens: 2048,
  excerptPrompt:
    '你是资深的博客编辑。根据用户提供的文章内容，撰写一段 80–120 字的中文摘要：准确概括主旨与关键信息，语气自然，只输出摘要本身，不要标题、不要前后缀、不要引号。',
  contentPrompt:
    '你是一位专业的中文博客作者。根据用户提供的标题与要点，写一篇结构清晰、可读性高的 Markdown 文章：使用多级标题、列表与必要的代码块，语言自然、专业，只输出文章正文，不要任何与内容无关的说明。',
};
