-- ============================================================================
-- Edge Blog — migration 0010
--   * automation_tasks.wechat_push —— 生成成功后是否同步推送到微信公众号草稿箱
--   * wechat_drafts                —— 文章 → 草稿 media_id 的映射（去重/更新）
--
-- 设计说明：
--   * 只做 `ALTER TABLE ADD COLUMN` 纯新增，避开 0009 那种「重建表 + 级联删除」
--     的坑（automation_runs.task_id 引用 automation_tasks 且 ON DELETE CASCADE）。
--   * wechat_drafts.post_id 唯一：同一篇文章只保留一条映射，重复推送走
--     draft/update 更新既有草稿，而不是在草稿箱里堆重复项。
-- ============================================================================

-- 1. 定时任务级开关：默认关闭，行为与升级前完全一致。
ALTER TABLE automation_tasks ADD COLUMN wechat_push INTEGER NOT NULL DEFAULT 0;

-- 2. 文章 → 草稿映射（去重/更新用）。
CREATE TABLE IF NOT EXISTS wechat_drafts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id        INTEGER NOT NULL UNIQUE REFERENCES posts(id) ON DELETE CASCADE,
  media_id       TEXT    NOT NULL,          -- 草稿 media_id
  thumb_media_id TEXT,                     -- 封面永久素材 id
  pushed_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wechat_drafts_pushed ON wechat_drafts (pushed_at DESC);
