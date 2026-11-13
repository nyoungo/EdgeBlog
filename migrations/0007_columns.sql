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
