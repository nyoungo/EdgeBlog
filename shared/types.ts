/**
 * Shared domain types — used by BOTH the Pages Functions (backend) and the
 * React app (frontend). Keep this file free of any runtime imports so it can be
 * bundled into either environment.
 *
 * Naming mirrors the SQL columns in migrations/0001_init.sql exactly, so a row
 * returned from D1 can be assigned to these types with no mapping layer.
 */

/* ------------------------------------------------------------------ users */

export type Role = 'admin' | 'editor';

export interface User {
  id: number;
  username: string;
  display_name: string | null;
  /** Never leave the server. Omitted from all API responses. */
  password_hash?: string;
  role: Role;
  created_at: string;
}

export type PublicUser = Omit<User, 'password_hash'>;

/* ------------------------------------------------------------------ posts */

export type PostStatus = 'draft' | 'published' | 'scheduled';

export interface Post {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  content_md: string;
  cover_url: string | null;
  status: PostStatus;
  published_at: string | null;
  meta_title: string | null;
  meta_description: string | null;
  og_image: string | null;
  word_count: number;
  featured: 0 | 1;
  views: number;
  author_id: number | null;
  created_at: string;
  updated_at: string;
}

/** Post shape used by list/card endpoints — content_md is omitted to keep payloads small. */
export type PostSummary = Omit<Post, 'content_md'> & {
  tags: Tag[];
  author_name: string | null;
};

/** Full post payload for the detail page. */
export interface PostDetail extends Post {
  tags: Tag[];
  author_name: string | null;
  prev: PostNeighbour | null;
  next: PostNeighbour | null;
  related: PostSummary[];
}

export interface PostNeighbour {
  slug: string;
  title: string;
}

/* ------------------------------------------------------------------- tags */

export interface Tag {
  id: number;
  name: string;
  slug: string;
  /** Only present on tag-listing endpoints. */
  post_count?: number;
}

/* --------------------------------------------------------------- comments */

export type CommentStatus = 'pending' | 'approved' | 'rejected' | 'spam';

export interface Comment {
  id: number;
  post_id: number;
  parent_id: number | null;
  author: string;
  content: string;
  status: CommentStatus;
  created_at: string;
  /** Nested replies, assembled on the server from the flat table. */
  replies?: Comment[];
  /** Comment being replied to, for the admin moderation view. */
  post_title?: string;
  post_slug?: string;
}

/* ------------------------------------------------------------------ media */

export interface MediaItem {
  id: number;
  key: string;
  url: string;
  filename: string | null;
  size: number;
  mime: string;
  width: number | null;
  height: number | null;
  created_at: string;
}

/* --------------------------------------------------------- settings model */

export type ThemeMode = 'light' | 'dark' | 'system';
export type FontChoice = 'sans' | 'serif';
export type FontScale = 'sm' | 'md' | 'lg';
export type RadiusSize = 'none' | 'sm' | 'md' | 'lg';
export type LineHeightChoice = 'compact' | 'normal' | 'relaxed';
export type SidebarPosition = 'left' | 'right' | 'none';
export type CardStyle = 'magazine' | 'minimal' | 'grid' | 'overlay' | 'compact';
export type CardSize = 'sm' | 'md' | 'lg';
export type CardBlur = 'none' | 'sm' | 'md' | 'lg';
export type ThemePreset =
  | 'ink'
  | 'midnight'
  | 'solar'
  | 'seasaltt'
  | 'forest'
  | 'cyber';

export interface SiteSettings {
  name: string;
  tagline: string;
  description: string;
  logo: { type: 'text' | 'image'; text: string; imageUrl: string };
  favicon: string;
  footerText: string;
  footerLinks: Array<{ label: string; href: string }>;
  locale: string;
}

export type BackgroundLayout =
  | 'cover'
  | 'contain'
  | 'center'
  | 'tile'
  | 'repeat-x'
  | 'repeat-y';

export type BackgroundAttachment = 'fixed' | 'scroll';

export interface ThemeSettings {
  preset: ThemePreset;
  mode: ThemeMode;
  /** Empty string => use the preset's primary color. */
  primaryColor: string;
  /** Global page background (light mode). Empty string => use the preset's background. */
  backgroundColor: string;
  /** Global background image URL. Empty string => none. */
  backgroundImage: string;
  /** How the background image is laid out (size + repeat preset). */
  backgroundLayout: BackgroundLayout;
  /** `fixed` keeps the image pinned to the viewport while scrolling. */
  backgroundAttachment: BackgroundAttachment;
  /** Scrim opacity over the image (0–0.9) so text stays readable. */
  backgroundScrim: number;
  fontBody: FontChoice;
  fontHeading: FontChoice;
  fontScale: FontScale;
  radius: RadiusSize;
  maxWidth: string;
  lineHeight: LineHeightChoice;
  codeTheme: string;
}

export type HomeModuleId =
  | 'hero'
  | 'latest'
  | 'featured'
  | 'tags'
  | 'newsletter';

export interface HomeModule {
  id: HomeModuleId;
  enabled: boolean;
}

export type HeroWidth = 'contained' | 'narrow' | 'full';
export type HeroAlign = 'left' | 'center';

/** Appearance of the homepage welcome ("hero") section. */
export interface HeroSettings {
  /** Box width: fills the content column, a narrow centred column, or full-bleed. */
  width: HeroWidth;
  /** Custom min-height (CSS length, e.g. `360px` / `60vh`); empty = auto. Ignored when `fullScreen`. */
  height: string;
  /** Full-bleed width and full viewport height. */
  fullScreen: boolean;
  /** CSS background (colour or gradient); empty = default gradient. */
  background: string;
  /** Background image URL (takes precedence over `background`). */
  backgroundImage: string;
  /** Scrim opacity over the background in light mode (0–1). */
  overlayLight: number;
  /** Scrim opacity over the background in dark mode (0–1). */
  overlayDark: number;
  /** Title & tagline colour (CSS colour); empty = inherit theme. */
  textColor: string;
  /** Description colour (CSS colour); empty = theme muted. */
  textMutedColor: string;
  align: HeroAlign;
}

export type NavPosition = 'static' | 'sticky' | 'fixed' | 'left';
export type NavStyle = 'default' | 'minimal' | 'pill';
export type NavBackground = 'solid' | 'glass' | 'transparent';
export type NavAlign = 'left' | 'center' | 'right';

/** Appearance of the site header / navigation bar. */
export interface HeaderSettings {
  /** `left` renders a vertical sidebar nav on desktop and a top bar on mobile. */
  position: NavPosition;
  style: NavStyle;
  background: NavBackground;
  /** Keep the bar transparent until the page is scrolled. */
  transparentOnTop: boolean;
  /** Bar height (CSS length, e.g. `64px`). */
  height: string;
  align: NavAlign;
}

export interface LayoutSettings {
  /** Ordered; the Appearance panel drag-sorts this array. */
  homeModules: HomeModule[];
  sidebar: SidebarPosition;
  cardStyle: CardStyle;
  /** Card size: affects padding, type scale and grid density. */
  cardSize: CardSize;
  /** Frosted-glass blur applied to card surfaces. */
  cardBlur: CardBlur;
  postsPerPage: number;
  hero: HeroSettings;
  header: HeaderSettings;
}

export interface NavItem {
  id: string;
  label: string;
  href: string;
  external: boolean;
  newTab: boolean;
}

export type SocialType =
  | 'github'
  | 'x'
  | 'email'
  | 'rss'
  | 'mastodon'
  | 'bluesky'
  | 'linkedin'
  | 'youtube'
  | 'wechat'
  | 'link';

export interface SocialLink {
  id: string;
  type: SocialType;
  label: string;
  url: string;
}

export interface FeatureFlags {
  comments: boolean;
  search: boolean;
  rss: boolean;
  views: boolean;
  viewTransitions: boolean;
  toc: boolean;
  backToTop: boolean;
  newsletter: boolean;
  relatedPosts: boolean;
  prevNext: boolean;
}

export interface AdvancedSettings {
  customCss: string;
  headHtml: string;
  footerHtml: string;
  analytics: { provider: 'none' | 'plausible' | 'umami' | 'ga4'; token: string };
}

export interface CommentSettings {
  requireModeration: boolean;
  allowGuests: boolean;
  maxDepth: number;
  rateLimitSeconds: number;
  minLength: number;
  maxLength: number;
}

export interface PageContent {
  title: string;
  contentMd: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ music */

export type MusicMode = 'cloud' | 'local';
export type MusicPlayMode = 'order' | 'single' | 'random';

/** A single track for the local-mode playlist (mirrors the player's SongInfo). */
export interface MusicTrack {
  id: string;
  title: string;
  artist?: string;
  cover?: string;
  src: string;
}

/** Configuration for the embedded XF music player (default: disabled). */
export interface MusicSettings {
  enabled: boolean;
  language: 'zh' | 'en';
  /** `cloud` fetches a playlist from `apiUrl`; `local` uses the `playlist` below. */
  mode: MusicMode;
  apiUrl: string;
  playlist: MusicTrack[];
  theme: string;
  playerWidth: string;
  bottom: string;
  songListHeight: string;
  visibleSongListCount: number;
  volume: number;
  playMode: MusicPlayMode;
  isAutoPopup: boolean;
  isAutoPlaylist: boolean;
  /** Start playing automatically once the player is ready (browsers may still
   *  require a user gesture; the player then waits for the first interaction). */
  autoplay: boolean;
  colorfulLyric: boolean;
  audioVisualizer: boolean;
  rememberPlayback: boolean;
}

/* ------------------------------------------------------------- ai (admin) */

export type AiProvider = 'openai' | 'deepseek' | 'custom';

/** Request kind for the AI helper: a short excerpt, or a full Markdown article. */
export type AiGenerateMode = 'excerpt' | 'content';

/** Admin-only AI provider configuration (kept out of the public payload). */
export interface AiSettings {
  enabled: boolean;
  provider: AiProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  excerptPrompt: string;
  contentPrompt: string;
}

/** AI settings safe to hand back to the admin UI (secret replaced by a flag). */
export type AiSettingsView = Omit<AiSettings, 'apiKey'> & { hasApiKey: boolean };

/** The full configuration object returned by GET /api/settings/public. */
export interface PublicSettings {
  site: SiteSettings;
  theme: ThemeSettings;
  layout: LayoutSettings;
  navigation: NavItem[];
  social: SocialLink[];
  features: FeatureFlags;
  advanced: Pick<AdvancedSettings, 'customCss' | 'headHtml' | 'footerHtml' | 'analytics'>;
  comments: CommentSettings;
  pages: { about: PageContent };
  music: MusicSettings;
}

/* ------------------------------------------------------------ api envelope */

export interface ApiMeta {
  page?: number;
  perPage?: number;
  total?: number;
  totalPages?: number;
}

export type ApiSuccess<T> = { ok: true; data: T; meta?: ApiMeta };
export type ApiFailure = { ok: false; error: { code: string; message: string; details?: unknown } };
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;
