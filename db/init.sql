-- ============================================================================
-- Edge Blog — complete database initialization (generated file, do not edit)
--
-- Apply this file ONCE to a brand-new, empty D1 database. It concatenates:
--   * migrations/0001_init.sql
--   * migrations/0002_fts.sql
--   * migrations/0003_auth_hardening.sql
--   * migrations/0004_write_amplification.sql
--   * migrations/0005_audit_and_soft_delete.sql
--   * migrations/0006_media_thumbnail.sql
--   * migrations/0007_columns.sql
--   * migrations/0008_automation.sql
--   * seed/seed.sql
--
-- Regenerate with: npm run db:bundle
--
-- If the database has already been initialized, do not run this file again:
-- the ALTER TABLE statements in 0003/0005/0006/0007 will fail with
-- "duplicate column name". Use the per-file migration path instead:
-- npm run db:migrate / npm run db:migrate:local.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- migrations/0001_init.sql
-- ---------------------------------------------------------------------------

-- ============================================================================
-- Edge Blog — core schema (migration 0001)
-- Target: Cloudflare D1 (SQLite).
--
-- Conventions:
--   * All timestamps are ISO-8601 UTC strings, produced by the SQLite
--     datetime function.
--   * "status" columns use CHECK constraints so bad states cannot be stored.
--   * Every foreign key declares an ON DELETE action. D1 always enforces
--     foreign keys (the equivalent of `PRAGMA foreign_keys = ON`), and rejects
--     that PRAGMA in some setups, so it is intentionally not executed here.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- users — blog authors / admins
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  display_name  TEXT,
  password_hash TEXT    NOT NULL,               -- pbkdf2$sha256$<iter>$<saltB64>$<hashB64>
  role          TEXT    NOT NULL DEFAULT 'admin'
                        CHECK (role IN ('admin', 'editor')),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- posts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS posts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  slug             TEXT    NOT NULL UNIQUE,
  title            TEXT    NOT NULL,
  excerpt          TEXT    NOT NULL DEFAULT '',
  content_md       TEXT    NOT NULL DEFAULT '',
  cover_url        TEXT,
  status           TEXT    NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft', 'published', 'scheduled')),
  published_at     TEXT,                        -- may be in the future while status is scheduled
  -- Per-post SEO overrides (fall back to global settings when NULL)
  meta_title       TEXT,
  meta_description TEXT,
  og_image         TEXT,
  -- Derived/denormalised values
  word_count       INTEGER NOT NULL DEFAULT 0,
  featured         INTEGER NOT NULL DEFAULT 0   -- 0/1 boolean for "featured" module
                           CHECK (featured IN (0, 1)),
  views            INTEGER NOT NULL DEFAULT 0,
  author_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_posts_status_published ON posts (status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_published_at     ON posts (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_featured         ON posts (featured, published_at DESC);

-- Keep updated_at honest whenever a row changes and the caller did not set it.
CREATE TRIGGER IF NOT EXISTS trg_posts_touch
AFTER UPDATE ON posts
WHEN new.updated_at = old.updated_at
BEGIN
  UPDATE posts SET updated_at = datetime('now') WHERE id = new.id;
END;

-- ---------------------------------------------------------------------------
-- tags + join table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  slug       TEXT    NOT NULL UNIQUE,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS post_tags (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_post_tags_tag ON post_tags (tag_id);

-- ---------------------------------------------------------------------------
-- comments (threaded, moderated)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    INTEGER NOT NULL REFERENCES posts(id)     ON DELETE CASCADE,
  parent_id  INTEGER          REFERENCES comments(id)  ON DELETE CASCADE,
  author     TEXT    NOT NULL,
  email      TEXT,                              -- never exposed publicly
  website    TEXT,
  content    TEXT    NOT NULL,
  status     TEXT    NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'approved', 'rejected', 'spam')),
  ip_hash    TEXT,                              -- salted SHA-256, for abuse only
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_comments_post   ON comments (post_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_status ON comments (status, created_at DESC);

-- ---------------------------------------------------------------------------
-- settings — the whole customization system lives here, one row per namespace
-- (site, theme, layout, navigation, social, features, advanced, pages...).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- media — R2 object index
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS media (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT    NOT NULL UNIQUE,           -- R2 object key
  url        TEXT    NOT NULL,                  -- public URL
  filename   TEXT,
  size       INTEGER NOT NULL DEFAULT 0,
  mime       TEXT    NOT NULL DEFAULT 'application/octet-stream',
  width      INTEGER,
  height     INTEGER,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_media_created ON media (created_at DESC);

-- ---------------------------------------------------------------------------
-- login_attempts — persistent rate-limit ledger for the auth endpoint.
-- (KV is used for hot counters; this gives durability + auditability.)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT    NOT NULL,                  -- e.g. "ip:<sha256>" or "user:<name>"
  success    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_key ON login_attempts (key, created_at DESC);

-- ---------------------------------------------------------------------------
-- migrations/0002_fts.sql
-- ---------------------------------------------------------------------------

-- ============================================================================
-- Edge Blog — full-text search (migration 0002)
--
-- Why a separate migration? FTS5 virtual tables + triggers are logically
-- distinct from the base schema and are the most likely thing to be rebuilt
-- (e.g. tokenizer change => REBUILD). Kept separate so it can be dropped and
-- recreated without touching data tables.
--
-- Tokenizer choice: `trigram`.
--   * The default `unicode61` tokenizer cannot segment Chinese/CJK text — a
--     whole run of CJK characters becomes a single token, so sub-string search
--     returns nothing. `trigram` indexes 3-character windows, which makes
--     substring search work for CJK *and* case-insensitive ASCII.
--   * Trade-off: queries must be >= 3 characters and it stores more data.
--     The search endpoint therefore falls back to a `LIKE` scan for short
--     queries (see functions/api/search).
--
-- This is an "external content" FTS table: it does not duplicate the post
-- body, it references posts(id). Triggers below are mandatory to keep it in
-- sync (D1 has no `contentless` sync helper).
-- ============================================================================

CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
  title,
  excerpt,
  content_md,
  content    = 'posts',
  content_rowid = 'id',
  tokenize   = 'trigram'
);

-- Rebuild from scratch if the table already had rows (idempotent-ish safety).
INSERT INTO posts_fts(posts_fts) VALUES('rebuild');

-- ----- keep in sync with the posts table ------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_posts_fts_ai
AFTER INSERT ON posts BEGIN
  INSERT INTO posts_fts(rowid, title, excerpt, content_md)
  VALUES (new.id, new.title, new.excerpt, new.content_md);
END;

CREATE TRIGGER IF NOT EXISTS trg_posts_fts_ad
AFTER DELETE ON posts BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, title, excerpt, content_md)
  VALUES ('delete', old.id, old.title, old.excerpt, old.content_md);
END;

CREATE TRIGGER IF NOT EXISTS trg_posts_fts_au
AFTER UPDATE ON posts BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, title, excerpt, content_md)
  VALUES ('delete', old.id, old.title, old.excerpt, old.content_md);
  INSERT INTO posts_fts(rowid, title, excerpt, content_md)
  VALUES (new.id, new.title, new.excerpt, new.content_md);
END;

-- ---------------------------------------------------------------------------
-- migrations/0003_auth_hardening.sql
-- ---------------------------------------------------------------------------

-- ============================================================================
-- Edge Blog — auth hardening (migration 0003)
--
-- token_version lets a stateless JWT be revoked: every issued token carries the
-- version it was signed with, and requireAuth/requireAdmin compare it with this
-- column. Password changes increment it, invalidating all older sessions.
--
-- Note: SQLite has no `ADD COLUMN IF NOT EXISTS`, so this file runs once per
-- database. `db:reset:local` is therefore only for a fresh local database.
-- ============================================================================

ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;

-- Comment tree lookups filter by parent_id; without this index deleting or
-- rendering a deep thread degrades into full scans.
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments (parent_id);

-- ---------------------------------------------------------------------------
-- migrations/0004_write_amplification.sql
-- ---------------------------------------------------------------------------

-- ============================================================================
-- Edge Blog — write amplification + ledger hygiene (migration 0004)
--
-- Problem: `UPDATE posts SET views = views + 1` used to fire BOTH triggers
--   1. trg_posts_touch  => rewrote updated_at, so every view looked like an
--      edit (article:modified_time / sitemap lastmod kept moving), and
--   2. trg_posts_fts_au => deleted + reinserted the whole FTS row for a body
--      that had not changed (expensive for long articles, blows up the FTS
--      index with pointless churn).
--
-- Fix: only touch updated_at when a column *other than* views changed, and
-- only re-index when the indexed columns actually changed.
--
-- `CREATE TRIGGER IF NOT EXISTS` cannot replace an existing definition, so the
-- old triggers are dropped first.
-- ============================================================================

DROP TRIGGER IF EXISTS trg_posts_touch;
CREATE TRIGGER trg_posts_touch
AFTER UPDATE ON posts
WHEN new.updated_at = old.updated_at AND new.views = old.views
BEGIN
  UPDATE posts SET updated_at = datetime('now') WHERE id = new.id;
END;

DROP TRIGGER IF EXISTS trg_posts_fts_au;
CREATE TRIGGER trg_posts_fts_au
AFTER UPDATE OF title, excerpt, content_md ON posts
BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, title, excerpt, content_md)
  VALUES ('delete', old.id, old.title, old.excerpt, old.content_md);
  INSERT INTO posts_fts(rowid, title, excerpt, content_md)
  VALUES (new.id, new.title, new.excerpt, new.content_md);
END;

-- login_attempts is pruned by age on successful logins; without an index the
-- delete degrades into a full scan as the ledger grows.
CREATE INDEX IF NOT EXISTS idx_login_attempts_created ON login_attempts (created_at);

-- ---------------------------------------------------------------------------
-- migrations/0005_audit_and_soft_delete.sql
-- ---------------------------------------------------------------------------

-- ============================================================================
-- Edge Blog — migration 0005
--   * audit_log: who did what (settings, posts, comments, media, auth)
--   * posts.deleted_at: soft delete / recycle bin for articles
-- ============================================================================

-- D1 enforces foreign keys automatically; `PRAGMA foreign_keys = ON` is
-- rejected by some D1 setups (SQLITE_AUTH), so it is intentionally omitted.

-- ---------------------------------------------------------------------------
-- audit_log — an append-only trail of privileged mutations.
-- Stored denormalised (actor_name) so the trail survives a user deletion.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    INTEGER,
  actor_name  TEXT,
  action      TEXT    NOT NULL,          -- e.g. "post.delete", "comment.status"
  target_type TEXT,                      -- "post" | "comment" | "media" | "setting" | ...
  target_id   INTEGER,
  detail      TEXT,                      -- small JSON blob (never secrets)
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action  ON audit_log (action, created_at DESC);

-- ---------------------------------------------------------------------------
-- posts.deleted_at — soft delete. NULL = live; a timestamp = in the trash.
-- Every public read filters `deleted_at IS NULL`, so a trashed article
-- disappears from lists, detail pages, search, RSS and the sitemap at once.
-- ---------------------------------------------------------------------------
ALTER TABLE posts ADD COLUMN deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_posts_deleted ON posts (deleted_at);

-- ---------------------------------------------------------------------------
-- migrations/0006_media_thumbnail.sql
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- media.thumbnail_url — 视频封面（缩略图）
--
-- 视频上传时由浏览器抽取首帧、压缩成 JPEG 后随同一次请求上传，服务端存进
-- R2 并把地址写在这里。英雄区在移动端不播放视频，直接用这张图当背景；
-- 桌面端也用它做 <video poster>，避免视频加载前出现空白。
-- 历史数据没有封面，读取时为空，前端会回退到背景色/渐变。
-- ---------------------------------------------------------------------------
ALTER TABLE media ADD COLUMN thumbnail_url TEXT;

-- ---------------------------------------------------------------------------
-- migrations/0007_columns.sql
-- ---------------------------------------------------------------------------

-- ============================================================================
-- Edge Blog — migration 0007
--   * columns: 专栏（可配置多个）
--   * posts.column_id: 文章归属。NULL = 博客文章，有值 = 该专栏的文章。
--
-- 设计与取舍：
--   * 一篇文章只能属于博客或某一个专栏，所以用单列外键而不是多对多关联表。
--   * ON DELETE SET NULL 作为兜底；API 层面会在专栏还有文章时直接拒绝删除，
--     避免文章悄悄回到博客列表造成内容混杂。
--   * 专栏本身带 visible（是否对外可见）与 show_in_sidebar（是否出现在首页
--     侧栏的专栏卡片里），侧栏排序直接复用 sort_order。
-- ============================================================================

CREATE TABLE IF NOT EXISTS columns (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slug            TEXT    NOT NULL UNIQUE,
  name            TEXT    NOT NULL,
  description     TEXT    NOT NULL DEFAULT '',
  cover_url       TEXT,
  -- 越小越靠前；相同值再按创建时间排序
  sort_order      INTEGER NOT NULL DEFAULT 0,
  visible         INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1)),
  show_in_sidebar INTEGER NOT NULL DEFAULT 0 CHECK (show_in_sidebar IN (0, 1)),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_columns_sort ON columns (visible, sort_order, id);

-- 与 posts 表既有触发器风格一致：没有显式更新 updated_at 时自动补上
CREATE TRIGGER IF NOT EXISTS trg_columns_touch
AFTER UPDATE ON columns
WHEN new.updated_at = old.updated_at
BEGIN
  UPDATE columns SET updated_at = datetime('now') WHERE id = new.id;
END;

-- ---------------------------------------------------------------------------
-- posts.column_id — 文章归属专栏（NULL = 博客）
-- ---------------------------------------------------------------------------
ALTER TABLE posts ADD COLUMN column_id INTEGER REFERENCES columns(id) ON DELETE SET NULL;

-- 专栏页按「专栏 + 状态 + 发布时间」翻页，博客列表按 column_id IS NULL 过滤，
-- 两者都吃这个索引。
CREATE INDEX IF NOT EXISTS idx_posts_column ON posts (column_id, status, published_at DESC);

-- ---------------------------------------------------------------------------
-- migrations/0008_automation.sql
-- ---------------------------------------------------------------------------

-- ============================================================================
-- Edge Blog — migration 0008
--   * automation_tasks: 定时自动生成文章的任务（提示词 + 目标 + 排期 + 封面策略）
--   * automation_runs:  每次执行的运行记录（成功/失败、产出文章、错误信息）
--
-- 设计说明：
--   * 排期字段（recurrence / time_of_day / weekday / day_of_month /
--     start_date / end_date）全部按 UTC+8（北京时间）语义理解与展示，
--     换算后的实际执行时间写成 next_run_at，统一用 SQLite 的
--     `YYYY-MM-DD HH:MM:SS` UTC 格式存储。
--   * Worker 的 Cron Trigger 只能写死在 wrangler.toml 里，无法按任务动态
--     生成，因此采用「固定频率轮询 + 到期执行」：定时器只挑
--     next_run_at <= 当前时间 且 enabled=1 的任务。
--   * column_id 为 NULL 表示生成到博客，有值表示生成到该专栏；与
--     posts.column_id 的归属模型保持一致。
-- ============================================================================

CREATE TABLE IF NOT EXISTS automation_tasks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  -- 生成要求 / 主题，直接交给 AI 作为写作指令
  prompt          TEXT    NOT NULL,
  -- 目标：NULL = 博客，有值 = 该专栏
  column_id       INTEGER REFERENCES columns(id) ON DELETE SET NULL,
  -- 标签（仅博客文章生效，专栏文章不进标签体系）；JSON 字符串数组
  tags_json       TEXT    NOT NULL DEFAULT '[]',
  -- 封面策略：ai = Workers AI 生成；fallback = 使用固定封面；none = 不设封面
  cover_mode      TEXT    NOT NULL DEFAULT 'ai'
                      CHECK (cover_mode IN ('ai', 'fallback', 'none')),
  cover_prompt    TEXT    NOT NULL DEFAULT '',   -- 生成封面时的额外提示
  cover_url       TEXT,                          -- fallback 封面地址
  -- 生成后的处理方式：draft = 保存为草稿（默认，需人工审核）；publish = 直接发布上线
  publish_mode    TEXT    NOT NULL DEFAULT 'draft'
                      CHECK (publish_mode IN ('draft', 'publish')),
  -- 排期（UTC+8 本地时间语义）
  recurrence      TEXT    NOT NULL DEFAULT 'once'
                      CHECK (recurrence IN ('once', 'daily', 'weekly', 'monthly')),
  time_of_day     TEXT    NOT NULL DEFAULT '09:00',  -- 'HH:MM'
  weekday         INTEGER NOT NULL DEFAULT 1 CHECK (weekday BETWEEN 0 AND 6),  -- 0=周日
  day_of_month    INTEGER NOT NULL DEFAULT 1 CHECK (day_of_month BETWEEN 1 AND 31),
  start_date      TEXT    NOT NULL,              -- 'YYYY-MM-DD'（UTC+8）：首次可运行日期
  end_date        TEXT,                          -- 'YYYY-MM-DD'（UTC+8）：可空
  enabled         INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  -- 调度状态：next_run_at 用 UTC 'YYYY-MM-DD HH:MM:SS'
  next_run_at     TEXT,
  last_run_at     TEXT,
  last_status     TEXT CHECK (last_status IN ('success', 'failed', 'running')),
  last_error      TEXT,
  last_post_id    INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by_name TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 定时器只查「启用且到期」的任务，这个索引让轮询保持廉价。
CREATE INDEX IF NOT EXISTS idx_automation_due ON automation_tasks (enabled, next_run_at);

-- 与既有表一致的 updated_at 自动补齐
CREATE TRIGGER IF NOT EXISTS trg_automation_tasks_touch
AFTER UPDATE ON automation_tasks
WHEN new.updated_at = old.updated_at
BEGIN
  UPDATE automation_tasks SET updated_at = datetime('now') WHERE id = new.id;
END;

-- ---------------------------------------------------------------------------
-- automation_runs — 每次执行的运行记录
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automation_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     INTEGER NOT NULL REFERENCES automation_tasks(id) ON DELETE CASCADE,
  status      TEXT    NOT NULL CHECK (status IN ('success', 'failed')),
  message     TEXT,
  post_id     INTEGER,
  post_slug   TEXT,
  cover_url   TEXT,
  started_at  TEXT,
  finished_at TEXT    NOT NULL DEFAULT (datetime('now')),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_task ON automation_runs (task_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- seed/seed.sql
-- ---------------------------------------------------------------------------

-- ============================================================================
-- Edge Blog — seed data
-- Apply AFTER migrations 0001 + 0002.
--
-- Default admin credentials:
--     username: admin
--     password: admin12345        <-- CHANGE IMMEDIATELY after first login
-- The hash below is PBKDF2-SHA256, 100000 iterations, 16-byte salt, 32-byte key.
-- Generate a new one with:  npm run hash-password -- "your-new-password"
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Admin user
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO users (id, username, display_name, password_hash, role)
VALUES (
  1,
  'admin',
  '站长',
  'pbkdf2$sha256$100000$7JLZTZlF8PGGrR8OIj10MQ==$7h5ZZqKw78X74klSabwLqz5Qt/OzbepItyy4Ji8GKOI=',
  'admin'
);

-- ---------------------------------------------------------------------------
-- Settings — the customization model. One row per namespace.
-- These values are the site defaults; the admin Appearance panel patches them.
-- ---------------------------------------------------------------------------
INSERT OR REPLACE INTO settings (key, value_json) VALUES
('site', json('{
  "name": "Edge Blog",
  "tagline": "在边缘写作，与世界相连",
  "description": "一个部署在 Cloudflare Pages 上的现代化动态博客，React + Hono + D1。",
  "logo": { "type": "text", "text": "Edge", "imageUrl": "" },
  "aboutLogo": "",
  "aboutText": "",
  "favicon": "",
  "footerText": "© 2026 Edge Blog. 保留所有权利。",
  "footerLinks": [
    { "label": "RSS", "href": "/rss.xml" },
    { "label": "Sitemap", "href": "/sitemap.xml" }
  ],
  "locale": "zh-CN"
}')),

('theme', json('{
  "preset": "ink",
  "mode": "system",
  "primaryColor": "",
  "backgroundColor": "",
  "backgroundColorLight": "",
  "backgroundColorDark": "",
  "backgroundImage": "",
  "backgroundLayout": "cover",
  "backgroundAttachment": "fixed",
  "backgroundScrim": 0.35,
  "fontBody": "sans",
  "fontHeading": "sans",
  "fontScale": "md",
  "radius": "md",
  "maxWidth": "100%",
  "lineHeight": "relaxed",
  "codeTheme": "github-dark",
  "codeThemeLight": "github",
  "glassOpacity": 0.34
}')),

('layout', json('{
  "homeModules": [
    { "id": "hero",       "enabled": true },
    { "id": "latest",     "enabled": true },
    { "id": "featured",   "enabled": true },
    { "id": "tags",       "enabled": true },
    { "id": "newsletter", "enabled": false }
  ],
  "sidebarModules": [
    { "id": "about",     "enabled": true },
    { "id": "latest",    "enabled": true },
    { "id": "columns",   "enabled": true },
    { "id": "tags",      "enabled": true },
    { "id": "subscribe", "enabled": true }
  ],
  "sidebar": "right",
  "cardStyle": "magazine",
  "cardSize": "md",
  "cardBlur": "none",
  "postsPerPage": 9,
  "hero": {
    "width": "contained",
    "height": "480px",
    "fullScreen": false,
    "background": "",
    "backgroundMedia": "",
    "backgroundImage": "",
    "backgroundVideo": "",
    "backgroundVideoLoop": true,
    "backgroundVideoFirstFromStart": true,
    "backgroundVideoStart": 0,
    "backgroundVideoEnd": 0,
    "overlayLight": 0,
    "overlayDark": 0,
    "textColor": "",
    "textMutedColor": "",
    "align": "left"
  },
  "header": {
    "position": "sticky",
    "style": "default",
    "background": "glass",
    "transparentOnTop": true,
    "height": "64px",
    "align": "center",
    "logoColor": "",
    "navColor": "",
    "actionColor": ""
  }
}')),

('navigation', json('[
  { "id": "nav-home",    "label": "首页", "href": "/",        "external": false, "newTab": false },
  { "id": "nav-posts",   "label": "文章", "href": "/posts",   "external": false, "newTab": false },
  { "id": "nav-columns", "label": "专栏", "href": "/columns", "external": false, "newTab": false },
  { "id": "nav-archive", "label": "归档", "href": "/archive", "external": false, "newTab": false },
  { "id": "nav-tags",    "label": "标签", "href": "/tags",    "external": false, "newTab": false },
  { "id": "nav-about",   "label": "关于", "href": "/about",   "external": false, "newTab": false }
]')),

('social', json('[
  { "id": "soc-github", "type": "github", "label": "GitHub", "url": "https://github.com" },
  { "id": "soc-x",      "type": "x",      "label": "X",      "url": "https://x.com" },
  { "id": "soc-email",  "type": "email",  "label": "邮箱",   "url": "mailto:hello@example.com" },
  { "id": "soc-rss",    "type": "rss",    "label": "RSS",    "url": "/rss.xml" }
]')),

('features', json('{
  "comments": true,
  "search": true,
  "rss": true,
  "views": true,
  "viewTransitions": true,
  "toc": true,
  "backToTop": true,
  "relatedPosts": true,
  "prevNext": true
}')),

('advanced', json('{
  "customCss": "",
  "headHtml": "",
  "footerHtml": "",
  "analytics": { "provider": "none", "token": "" }
}')),

('pages', json('{
  "about": {
    "title": "关于本站",
    "contentMd": "## 你好，世界 👋\n\n这里是一个运行在 Cloudflare 边缘网络上的动态博客。\n\n- **前端**：React + TypeScript + Vite + TailwindCSS\n- **后端**：Cloudflare Workers（Hono）\n- **数据**：D1（SQLite）+ R2（对象存储）+ KV（缓存）\n\n全站外观、布局、导航与功能开关都可以在后台的「外观设置」中可视化调整，无需改动代码。\n\n### 联系方式\n\n欢迎通过页脚的社交链接与我联系。",
    "updatedAt": "2026-01-01 00:00:00"
  }
}')),

-- Comment policy knobs, editable from the admin panel.
('comments', json('{
  "requireModeration": true,
  "allowGuests": true,
  "maxDepth": 3,
  "rateLimitSeconds": 30,
  "minLength": 2,
  "maxLength": 2000
}')),

-- Music player (XF Music Player). Disabled by default; enable in the admin panel.
('music', json('{
  "enabled": false,
  "language": "zh",
  "mode": "cloud",
  "apiUrl": "https://music.api.xfyun.club/api/v1/music/top?platform=netease&topId=3778678",
  "playlist": [],
  "theme": "auto-theme",
  "playerWidth": "324px",
  "bottom": "28px",
  "songListHeight": "350px",
  "visibleSongListCount": 4,
  "volume": 0.8,
  "playMode": "order",
  "isAutoPopup": false,
  "isAutoPlaylist": false,
  "autoplay": false,
  "colorfulLyric": false,
  "audioVisualizer": false,
  "rememberPlayback": true
}')),

-- AI helper (admin-only namespace; the API key is never exposed publicly).
('ai', json('{
  "enabled": false,
  "provider": "cloudflare",
  "baseUrl": "",
  "apiKey": "",
  "model": "@cf/zai-org/glm-4.7-flash",
  "temperature": 0.7,
  "maxTokens": 2048,
  "excerptPrompt": "你是资深的博客编辑。根据用户提供的文章内容，撰写一段 80–120 字的中文摘要：准确概括主旨与关键信息，语气自然，只输出摘要本身，不要标题、不要前后缀、不要引号。",
  "contentPrompt": "你是一位专业的中文博客作者。根据用户提供的标题与要点，写一篇结构清晰、可读性高的 Markdown 文章：使用多级标题、列表与必要的代码块，语言自然、专业，只输出文章正文，不要任何与内容无关的说明。"
}'));

-- ---------------------------------------------------------------------------
-- Tags
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO tags (id, name, slug) VALUES
  (1, 'Cloudflare', 'cloudflare'),
  (2, 'React',      'react'),
  (3, 'TypeScript', 'typescript'),
  (4, '设计',        'design'),
  (5, '随笔',        'essay');

-- ---------------------------------------------------------------------------
-- Posts
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO posts
  (id, slug, title, excerpt, content_md, cover_url, status, published_at,
   meta_title, meta_description, word_count, featured, views, author_id, created_at, updated_at)
VALUES
(
  1,
  'hello-edge-blog',
  '从零搭建边缘博客：技术选型与取舍',
  '为什么选择 Cloudflare Pages 全家桶？本文记录这套可定制动态博客的架构决策、数据模型与渲染策略。',
  '## 为什么要做这个项目

静态博客很好，但一旦需要「后台实时编辑、评论审核、全站可视化定制」，静态生成就开始拧巴。于是有了这个项目：**内容与配置全部存在服务端，页面依然是 SPA**。

## 技术选型

| 层 | 选型 | 原因 |
| --- | --- | --- |
| 前端 | React + Vite | 生态成熟，HMR 快 |
| 路由 | React Router | 声明式，支持 data router |
| 样式 | Tailwind + CSS 变量 | 原子类保证一致，变量驱动换肤 |
| 后端 | Hono on Cloudflare Workers | 极小、Web 标准、TS 友好 |
| 数据 | D1 (SQLite) | 边缘复制，SQL 直观 |
| 存储 | R2 | 零出口费，图片友好 |

## 一个关键决策：渲染在哪一层

Markdown 的 HTML 渲染放在**浏览器端**，而不是 Worker。原因是 XSS 净化：

```ts
import { marked } from "marked";
import DOMPurify from "dompurify";

const html = DOMPurify.sanitize(marked.parse(md));
```

DOMPurify 依赖真实的 DOM，在 Workers 里没有 `window`。把渲染 + 净化都放到浏览器，既避免了在边缘拼一个 DOM shim，也让净化更难被绕过。SEO 需要的 `title/description/og` 由 Pages Function 在 HTML 外壳里注入，爬虫拿得到。

## 数据模型速览

- `posts` 存正文 Markdown 与 SEO 覆盖字段
- `posts_fts` 是 FTS5 虚表，用 `trigram` 分词器以支持中文子串搜索
- `settings` 以命名空间为单位存 JSON，是整个定制系统的单一事实来源

> 边缘部署的意义不是「快」本身，而是把复杂度从运维里拿掉。

到这里，地基就打好了。',
  NULL, 'published', '2026-01-02 08:00:00',
  '从零搭建边缘博客：技术选型与取舍',
  'Cloudflare Pages 动态博客的架构决策：React + Hono + D1 + R2，以及为什么 Markdown 渲染放在浏览器端。',
  420, 1, 128, 1, '2026-01-02 08:00:00', '2026-01-02 08:00:00'
),
(
  2,
  'd1-sqlite-patterns',
  'D1 使用心得：没有事务时怎么保证一致性',
  'D1 是 SQLite，但不是完整 SQLite。聊聊批处理、FTS5 与幂等写入的实践。',
  '## D1 的现实

D1 基于 SQLite，但**不支持交互式事务**（`BEGIN ... COMMIT`）。这会影响很多习惯写法。

### 用 batch 代替事务

`db.batch([...])` 会在一个隐式事务里执行一组语句：

```ts
await env.DB.batch([
  db.prepare("INSERT INTO posts (slug, title) VALUES (?, ?)").bind(slug, title),
  db.prepare("INSERT INTO post_tags (post_id, tag_id) VALUES (last_insert_rowid(), ?)").bind(tagId),
]);
```

只要其中一条失败，整批回滚。这是 D1 里最接近事务的东西。

### 全文搜索用 FTS5

不要用 `LIKE %keyword%` 扫全表。建一张 FTS5 虚表：

```sql
CREATE VIRTUAL TABLE posts_fts USING fts5(
  title, excerpt, content_md,
  content = ''posts'', content_rowid = ''id'',
  tokenize = ''trigram''
);
```

`trigram` 分词器对中文尤其重要 —— 默认的 `unicode61` 会把一整段中文当成一个词，子串搜索必然失败。

### 幂等写入

部署脚本、Webhook 都可能重放。给关键写入加 `INSERT OR IGNORE` 或唯一索引，重放不会产生脏数据。

## 小结

- 用 `batch` 表达原子性
- 用 FTS5 表达搜索
- 用唯一约束表达幂等',
  NULL, 'published', '2026-01-04 09:30:00',
  'D1 使用心得：没有事务时如何保证一致性',
  'Cloudflare D1 的 batch、FTS5 trigram 分词与幂等写入的工程实践。',
  320, 0, 96, 1, '2026-01-04 09:30:00', '2026-01-04 09:30:00'
),
(
  3,
  'design-tokens-theming',
  '用设计令牌驱动主题：一套变量，无限皮肤',
  '把颜色、间距、圆角抽象成 CSS 变量，配合 data-theme 属性，实现零刷新换肤。',
  '## 问题

如果每个组件都写死颜色，换肤就变成了全量搜索替换。我们想要的是：**改一处变量，全站变色，且不刷新页面**。

## 令牌分层

设计令牌分三层，职责清晰：

1. **原始令牌（primitive）**：`--indigo-500: 99 102 241;`
2. **语义令牌（semantic）**：`--c-brand: var(--indigo-500);`
3. **组件令牌**：直接消费语义令牌

组件只碰语义令牌，皮肤只重写语义令牌。

```css
:root {
  --c-bg: 255 255 255;
  --c-fg: 17 24 39;
  --radius: 12px;
}

[data-theme="dark"] {
  --c-bg: 10 10 10;
  --c-fg: 237 237 240;
}
```

注意值用**空格分隔的 RGB 通道**，这样 Tailwind 才能用 `rgb(var(--c-bg) / <alpha-value>)` 表达透明度。

## 运行时切换

切换主题只需改 `<html>` 上的属性，浏览器重绘，无需重新打包：

```ts
document.documentElement.dataset.theme = "dark";
```

配合 View Transitions API，还能得到平滑的过渡：

```ts
document.startViewTransition(() => {
  document.documentElement.dataset.theme = next;
});
```

## 落在配置里

这套令牌的取值最终来自 `settings.theme`，后台改一次，前端注入到 `<html style>`，即时生效。',
  NULL, 'published', '2026-01-06 14:15:00',
  '用设计令牌驱动主题：一套变量，无限皮肤',
  'CSS 变量分层、data-theme 切换与 View Transitions，实现零刷新换肤。',
  260, 1, 74, 1, '2026-01-06 14:15:00', '2026-01-06 14:15:00'
),
(
  4,
  'scheduled-post-sample',
  '（草稿）下一篇预告：评论系统的防刷设计',
  '如何用蜜罐、频率限制与内容指纹，在不引入验证码的前提下遏制垃圾评论。',
  '## 预告

本文尚未发布，用于演示 `draft` 与 `scheduled` 状态。',
  NULL, 'draft', NULL,
  NULL, NULL, 20, 0, 0, 1, '2026-01-07 10:00:00', '2026-01-07 10:00:00'
);

-- ---------------------------------------------------------------------------
-- Post ↔ Tag
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES
  (1, 1), (1, 2), (1, 3),
  (2, 1), (2, 3),
  (3, 4), (3, 5),
  (4, 1), (4, 2);

-- ---------------------------------------------------------------------------
-- Sample comments (one approved, one pending) to exercise moderation UI
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO comments (id, post_id, parent_id, author, email, content, status, ip_hash, created_at) VALUES
  (1, 1, NULL, '小明', 'ming@example.com', '写得很清楚，尤其是渲染放在浏览器端那段，受教了。', 'approved', 'seed', '2026-01-03 12:00:00'),
  (2, 1, 1,    '站长',  NULL,               '谢谢！DOMPurify 那层确实不能省。',              'approved', 'seed', '2026-01-03 13:20:00'),
  (3, 2, NULL, 'Vector', NULL,             'batch 那段帮我解决了一个 bug，感谢。',          'pending',  'seed', '2026-01-05 08:10:00');

-- ---------------------------------------------------------------------------
-- Media index sample row (no R2 object required; illustrates the shape)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO media (id, key, url, filename, size, mime, width, height, created_at) VALUES
  (1, 'seed/og-cover.png', '/media/seed/og-cover.png', 'og-cover.png', 0, 'image/png', 1200, 630, '2026-01-01 00:00:00');
