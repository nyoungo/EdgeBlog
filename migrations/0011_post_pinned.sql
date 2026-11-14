-- Edge Blog — migration 0011
-- 文章置顶状态；公开列表排序时置顶文章优先。
ALTER TABLE posts ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_posts_pinned_published
  ON posts (pinned DESC, status, published_at DESC);
