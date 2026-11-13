/**
 * Shared domain types — used by BOTH the Worker (backend) and the
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

/** 文章归属：博客（NULL）或某一个专栏。 */
export interface ColumnRef {
  id: number;
  slug: string;
  name: string;
}

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
  /** NULL = 博客文章；有值 = 该专栏的文章。 */
  column_id: number | null;
  created_at: string;
  updated_at: string;
}

/** Post shape used by list/card endpoints — content_md is omitted to keep payloads small. */
export type PostSummary = Omit<Post, 'content_md'> & {
  tags: Tag[];
  author_name: string | null;
  /** 归属专栏（仅专栏文章返回），用于列表与搜索结果的标注。 */
  column?: ColumnRef | null;
};

/** Full post payload for the detail page. */
export interface PostDetail extends Post {
  tags: Tag[];
  author_name: string | null;
  /** 所属专栏；博客文章为 null。 */
  column: ColumnRef | null;
  prev: PostNeighbour | null;
  next: PostNeighbour | null;
  related: PostSummary[];
}

/* ---------------------------------------------------------------- columns */

/** 一篇文章条目的精简形态，用于专栏卡片里展示「最新文章」。 */
export interface ColumnPostRef {
  id: number;
  slug: string;
  title: string;
  published_at: string | null;
  created_at: string;
}

export interface Column {
  id: number;
  slug: string;
  name: string;
  description: string;
  cover_url: string | null;
  sort_order: number;
  /** 0/1：是否对访客可见。隐藏的专栏及其文章不出现在任何公开入口。 */
  visible: 0 | 1;
  /** 0/1：是否出现在首页侧栏的「专栏」卡片里。 */
  show_in_sidebar: 0 | 1;
  created_at: string;
  updated_at: string;
}

/** 公开专栏列表项：卡片所需的统计与最新文章。 */
export interface ColumnSummary extends Column {
  post_count: number;
  /** 最近一次发文时间（用于「x 天前更新」）。 */
  last_published_at: string | null;
  latest: ColumnPostRef[];
}

/** 侧栏卡片分组：绑定的专栏 + 该栏最新几篇。 */
export interface SidebarColumn extends ColumnRef {
  latest: ColumnPostRef[];
}

export interface PostNeighbour {
  slug: string;
  title: string;
}

/** Row shape of `GET /api/posts/archive` — just enough for a year list. */
export interface ArchiveEntry {
  slug: string;
  title: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A post in the recycle bin (`deleted_at` is set). */
export type TrashedPost = Omit<Post, 'content_md'> & {
  deleted_at: string;
  tags: Tag[];
  author_name: string | null;
};

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
  /** 视频封面图地址（上传时由首帧生成）；旧数据或图片为 null。 */
  thumbnail_url: string | null;
  created_at: string;
}

/** A post that references a media object — used before deleting an image. */
export interface MediaUsage {
  id: number;
  slug: string;
  title: string;
  status: PostStatus;
}

/* ------------------------------------------------------- automation (定时发文) */

export type AutomationRecurrence = 'once' | 'daily' | 'weekly' | 'monthly';

/**
 * 封面策略:
 *   ai       = Workers AI 生成;
 *   agent    = AI 联网找图并入库;
 *   fallback = 指定图片(本站地址直接引用,外网直链执行时下载入库);
 *   none     = 不设封面。
 */
export type AutomationCoverMode = 'ai' | 'agent' | 'fallback' | 'none';

/** 生成后的处理方式：draft = 保存为草稿；publish = 直接发布上线。 */
export type AutomationPublishMode = 'draft' | 'publish';

export type AutomationRunStatus = 'success' | 'failed';
export type AutomationLastStatus = AutomationRunStatus | 'running';

/**
 * 一条定时自动写文任务。
 *
 * 排期字段（recurrence / time_of_day / weekday / day_of_month / start_date /
 * end_date）全部是 UTC+8（北京时间）语义；`next_run_at` 是换算后的 UTC 时间，
 * 与 posts.published_at 等使用同一 SQLite `YYYY-MM-DD HH:MM:SS` 格式。
 */
export interface AutomationTask {
  id: number;
  name: string;
  /** 写作要求 / 主题，直接作为 AI 指令。 */
  prompt: string;
  /** NULL = 生成到博客；有值 = 生成到该专栏。 */
  column_id: number | null;
  /** JSON 字符串数组；仅博客文章生效。 */
  tags_json: string;
  cover_mode: AutomationCoverMode;
  cover_prompt: string;
  cover_url: string | null;
  publish_mode: AutomationPublishMode;
  recurrence: AutomationRecurrence;
  /** 'HH:MM'（UTC+8）。 */
  time_of_day: string;
  /** 0=周日 … 6=周六（weekly 有效）。 */
  weekday: number;
  /** 1–31（monthly 有效）。 */
  day_of_month: number;
  /** 'YYYY-MM-DD'（UTC+8）：首次可运行日期。 */
  start_date: string;
  end_date: string | null;
  enabled: 0 | 1;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: AutomationLastStatus | null;
  last_error: string | null;
  last_post_id: number | null;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

/** 后台列表用的任务视图：标签与归属已在服务端展开。 */
export interface AutomationTaskView extends Omit<AutomationTask, 'tags_json'> {
  tags: string[];
  column: ColumnRef | null;
  /** 最近一次成功生成的文章（供列表跳转）。 */
  last_post: { id: number; slug: string; title: string; status: PostStatus } | null;
}

/** 一次执行的运行记录。 */
export interface AutomationRun {
  id: number;
  task_id: number;
  status: AutomationRunStatus;
  message: string | null;
  post_id: number | null;
  post_slug: string | null;
  cover_url: string | null;
  started_at: string | null;
  finished_at: string;
  created_at: string;
}

/* ------------------------------------------------------------------ audit */

export interface AuditLogEntry {
  id: number;
  actor_id: number | null;
  actor_name: string | null;
  action: string;
  target_type: string | null;
  target_id: number | null;
  detail: string | null;
  created_at: string;
}

/* --------------------------------------------------------- settings model */

export type ThemeMode = 'light' | 'dark' | 'system';
export type FontChoice = 'sans' | 'serif' | 'mono';
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
  /** 首页侧栏「关于」卡片:可单独设置圆形头像与简介,留空回退到站点 Logo / 描述。 */
  aboutLogo: string;
  aboutText: string;
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
  /**
   * @deprecated Legacy light-mode background. Kept so rows saved before the
   * split keep rendering; the editor writes the two fields below instead.
   */
  backgroundColor: string;
  /** Global page background for light mode. Empty => preset background. */
  backgroundColorLight: string;
  /** Global page background for dark mode. Empty => preset background. */
  backgroundColorDark: string;
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
  /** Dark-mode code highlight theme (legacy single value). */
  codeTheme: string;
  /** Light-mode code highlight theme; empty = paired default (github). */
  codeThemeLight?: string;
  /**
   * Glass tint opacity for the header (0.05–0.95). Lower = more transparent.
   * Panels and chips derive from this value.
   */
  glassOpacity?: number;
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

export type SidebarModuleId = 'about' | 'latest' | 'columns' | 'tags' | 'subscribe';

/** 侧栏卡片开关；数组顺序即渲染顺序。 */
export interface SidebarModule {
  id: SidebarModuleId;
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
  /**
   * Background video URL. Highest priority in the hero fallback chain
   * (video → image → colour).
   */
  backgroundVideo: string;
  /**
   * Background image URL. Shown when there is no video, and used as the video
   * poster on mobile / before the first frame loads.
   */
  backgroundImage: string;
  /**
   * Legacy unified media URL (image or video in one field), kept so rows saved
   * before the split keep rendering. New values go to the two fields above.
   */
  backgroundMedia: string;
  /** Loop the background video; when false it plays once and holds the last frame. */
  backgroundVideoLoop: boolean;
  /** Play the first pass from 0 instead of starting directly at `backgroundVideoStart`. */
  backgroundVideoFirstFromStart: boolean;
  /** Loop range start in seconds. The first pass starts here when `backgroundVideoFirstFromStart` is off. */
  backgroundVideoStart: number;
  /** Loop range end in seconds; 0 = end of the clip. Also stops here when looping is off. */
  backgroundVideoEnd: number;
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
  /** Logo wordmark colour (CSS colour); empty = theme foreground. */
  logoColor: string;
  /** Navigation link colour (CSS colour); empty = theme active/muted colours. */
  navColor: string;
  /** Colour of the action icons on the right (search / theme / admin / menu); empty = theme. */
  actionColor: string;
}

export interface LayoutSettings {
  /** Ordered; the Appearance panel drag-sorts this array. */
  homeModules: HomeModule[];
  /** 侧栏卡片（关于 / 最新 / 标签 / 订阅）的功能开关。 */
  sidebarModules: SidebarModule[];
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

export type AiProvider = 'cloudflare' | 'openai' | 'deepseek' | 'custom';

/** Request kind for the AI helper: a short excerpt, or a full Markdown article. */
export type AiGenerateMode = 'excerpt' | 'content';

/** Admin-only AI provider configuration (kept out of the public payload). */
export interface AiSettings {
  enabled: boolean;
  provider: AiProvider;
  baseUrl: string;
  apiKey: string;
  /** Monid 搜索网关（api.monid.ai）的 API Key，仅用于后台助手的联网搜索。 */
  monidApiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  excerptPrompt: string;
  contentPrompt: string;
}

/** AI settings safe to hand back to the admin UI (secrets replaced by flags). */
export type AiSettingsView = Omit<AiSettings, 'apiKey' | 'monidApiKey'> & {
  hasApiKey: boolean;
  /** Monid 搜索网关是否已配置 API Key。 */
  hasMonidApiKey: boolean;
  /** Workers AI binding (`env.AI`) is present in this deployment. */
  bindingAvailable: boolean;
  /** Feature is enabled AND the selected provider is actually usable. */
  ready: boolean;
};

/* ------------------------------------------------------- ai chat assistant */

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Extra page context the assistant can use without asking the user. */
export interface AiChatContext {
  /** Current admin path, e.g. /admin/posts/hello-world. */
  path?: string;
  postId?: number;
  postSlug?: string;
}

/** One tool the assistant executed while handling a message. */
export interface AiChatAction {
  tool: string;
  summary: string;
  ok: boolean;
}

export interface AiChatResult {
  reply: string;
  actions: AiChatAction[];
}

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
