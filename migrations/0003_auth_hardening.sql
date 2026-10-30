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
