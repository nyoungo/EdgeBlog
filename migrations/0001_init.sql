-- ============================================================================
-- Edge Blog — core schema (migration 0001)
-- Target: Cloudflare D1 (SQLite).
--
-- Conventions:
--   * All timestamps are ISO-8601 UTC strings, produced by datetime('now').
--   * "status" columns use CHECK constraints so bad states cannot be stored.
--   * Every foreign key declares an ON DELETE action; D1 enforces FKs when
--     `PRAGMA foreign_keys = ON` is set per-connection (see functions/db.ts).
-- ============================================================================

PRAGMA foreign_keys = ON;

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
  published_at     TEXT,                        -- may be in the future for 'scheduled'
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
