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
