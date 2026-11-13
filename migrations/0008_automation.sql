-- ============================================================================
-- Edge Blog — migration 0008
--   * automation_tasks: 定时自动生成文章的任务（提示词 + 目标 + 排期 + 封面策略）
--   * automation_runs:  每次执行的运行记录（成功/失败、产出文章、错误信息）
--
-- 设计说明：
--   * 排期字段（recurrence / time_of_day / weekday / day_of_month /
--     start_date / end_date）全部按 UTC+8（北京时间）语义理解与展示，
--     换算后的实际执行时间写成 next_run_at，统一用 SQLite 的
--     `YYYY-MM-DD HH:MM:SS` UTC 格式存储。
--   * Worker 的 Cron Trigger 只能写死在 wrangler.toml 里，无法按任务动态
--     生成，因此采用「固定频率轮询 + 到期执行」：定时器只挑
--     next_run_at <= 当前时间 且 enabled=1 的任务。
--   * column_id 为 NULL 表示生成到博客，有值表示生成到该专栏；与
--     posts.column_id 的归属模型保持一致。
-- ============================================================================

CREATE TABLE IF NOT EXISTS automation_tasks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  -- 生成要求 / 主题，直接交给 AI 作为写作指令
  prompt          TEXT    NOT NULL,
  -- 目标：NULL = 博客，有值 = 该专栏
  column_id       INTEGER REFERENCES columns(id) ON DELETE SET NULL,
  -- 标签（仅博客文章生效，专栏文章不进标签体系）；JSON 字符串数组
  tags_json       TEXT    NOT NULL DEFAULT '[]',
  -- 封面策略：ai = Workers AI 生成；fallback = 使用固定封面；none = 不设封面
  cover_mode      TEXT    NOT NULL DEFAULT 'ai'
                      CHECK (cover_mode IN ('ai', 'fallback', 'none')),
  cover_prompt    TEXT    NOT NULL DEFAULT '',   -- 生成封面时的额外提示
  cover_url       TEXT,                          -- fallback 封面地址
  -- 生成后的处理方式：draft = 保存为草稿（默认，需人工审核）；publish = 直接发布上线
  publish_mode    TEXT    NOT NULL DEFAULT 'draft'
                      CHECK (publish_mode IN ('draft', 'publish')),
  -- 排期（UTC+8 本地时间语义）
  recurrence      TEXT    NOT NULL DEFAULT 'once'
                      CHECK (recurrence IN ('once', 'daily', 'weekly', 'monthly')),
  time_of_day     TEXT    NOT NULL DEFAULT '09:00',  -- 'HH:MM'
  weekday         INTEGER NOT NULL DEFAULT 1 CHECK (weekday BETWEEN 0 AND 6),  -- 0=周日
  day_of_month    INTEGER NOT NULL DEFAULT 1 CHECK (day_of_month BETWEEN 1 AND 31),
  start_date      TEXT    NOT NULL,              -- 'YYYY-MM-DD'（UTC+8）：首次可运行日期
  end_date        TEXT,                          -- 'YYYY-MM-DD'（UTC+8）：可空
  enabled         INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  -- 调度状态：next_run_at 用 UTC 'YYYY-MM-DD HH:MM:SS'
  next_run_at     TEXT,
  last_run_at     TEXT,
  last_status     TEXT CHECK (last_status IN ('success', 'failed', 'running')),
  last_error      TEXT,
  last_post_id    INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by_name TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 定时器只查「启用且到期」的任务，这个索引让轮询保持廉价。
CREATE INDEX IF NOT EXISTS idx_automation_due ON automation_tasks (enabled, next_run_at);

-- 与既有表一致的 updated_at 自动补齐
CREATE TRIGGER IF NOT EXISTS trg_automation_tasks_touch
AFTER UPDATE ON automation_tasks
WHEN new.updated_at = old.updated_at
BEGIN
  UPDATE automation_tasks SET updated_at = datetime('now') WHERE id = new.id;
END;

-- ---------------------------------------------------------------------------
-- automation_runs — 每次执行的运行记录
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automation_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     INTEGER NOT NULL REFERENCES automation_tasks(id) ON DELETE CASCADE,
  status      TEXT    NOT NULL CHECK (status IN ('success', 'failed')),
  message     TEXT,
  post_id     INTEGER,
  post_slug   TEXT,
  cover_url   TEXT,
  started_at  TEXT,
  finished_at TEXT    NOT NULL DEFAULT (datetime('now')),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_task ON automation_runs (task_id, created_at DESC);
