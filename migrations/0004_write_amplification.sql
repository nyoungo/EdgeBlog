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
