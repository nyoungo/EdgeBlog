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