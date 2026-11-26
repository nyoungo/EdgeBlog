-- Edge Blog — migration 0012
-- 定时发文「指定封面」模式：可选让视觉模型看图生成一段描述，作为正文写作素材。
-- 关闭时（默认 0）行为与之前完全一致，不会额外调用模型。
ALTER TABLE automation_tasks
  ADD COLUMN cover_describe INTEGER NOT NULL DEFAULT 0 CHECK (cover_describe IN (0, 1));
