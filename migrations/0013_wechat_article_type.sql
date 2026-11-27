-- ============================================================================
-- Edge Blog — migration 0013
--   * automation_tasks.wechat_article_type —— 定时任务推公众号时用图文还是图片消息
--   * wechat_drafts.article_type            —— 记录既有草稿是哪种消息，重复推送时按它判断
--   * wechat_drafts.images_json             —— newspic 已上传的永久素材 id 缓存
--
-- 设计说明：
--   * 图片消息（newspic）的 `image_media_id` 必须是永久素材 id，每篇最多 20 张；
--     永久素材有数量上限，重复推送同一篇必须复用旧 id，否则会把素材库塞满。
--     所以这里缓存 `[{ url, mediaId }]`，按去掉 fragment 的 URL 匹配。
--   * 仍然是纯 `ALTER TABLE ADD COLUMN`，不做整表重建（避免 0009 那种级联删除）。
--   * 默认值 'news' / '[]'，升级后行为与之前完全一致。
-- ============================================================================

ALTER TABLE automation_tasks
  ADD COLUMN wechat_article_type TEXT NOT NULL DEFAULT 'news'
    CHECK (wechat_article_type IN ('news', 'newspic'));

ALTER TABLE wechat_drafts
  ADD COLUMN article_type TEXT NOT NULL DEFAULT 'news'
    CHECK (article_type IN ('news', 'newspic'));

ALTER TABLE wechat_drafts
  ADD COLUMN images_json TEXT NOT NULL DEFAULT '[]';
