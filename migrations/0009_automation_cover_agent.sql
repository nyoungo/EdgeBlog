-- ============================================================================
-- Edge Blog — migration 0009
--   * automation_tasks.cover_mode 增加 'agent'(AI 联网找图并入库)
--
-- 为什么整表重建:
--   SQLite 不能直接修改列的 CHECK 约束,只能重建表。而 automation_runs.task_id
--   引用 automation_tasks(id) ON DELETE CASCADE —— 在开启外键时 DROP TABLE 会
--   先做隐式 DELETE,把子表(runs)的行级联删掉。所以这里先把运行记录备份到
--   临时表,重建 tasks 后再原样恢复,避免丢失历史。
-- ============================================================================

-- 1. 备份运行记录(DROP TABLE 的级联删除会把它们清空)
CREATE TABLE automation_runs_backup AS SELECT * FROM automation_runs;

-- 2. 建新表:仅 cover_mode 的 CHECK 增加 'agent',其余与原定义保持一致
CREATE TABLE automation_tasks_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  prompt          TEXT    NOT NULL,
  column_id       INTEGER REFERENCES columns(id) ON DELETE SET NULL,
  tags_json       TEXT    NOT NULL DEFAULT '[]',
  cover_mode      TEXT    NOT NULL DEFAULT 'ai'
                      CHECK (cover_mode IN ('ai', 'agent', 'fallback', 'none')),
  cover_prompt    TEXT    NOT NULL DEFAULT '',
  cover_url       TEXT,
  publish_mode    TEXT    NOT NULL DEFAULT 'draft'
                      CHECK (publish_mode IN ('draft', 'publish')),
  recurrence      TEXT    NOT NULL DEFAULT 'once'
                      CHECK (recurrence IN ('once', 'daily', 'weekly', 'monthly')),
  time_of_day     TEXT    NOT NULL DEFAULT '09:00',
  weekday         INTEGER NOT NULL DEFAULT 1 CHECK (weekday BETWEEN 0 AND 6),
  day_of_month    INTEGER NOT NULL DEFAULT 1 CHECK (day_of_month BETWEEN 1 AND 31),
  start_date      TEXT    NOT NULL,
  end_date        TEXT,
  enabled         INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
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

-- 3. 复制原数据(显式列名,避免列顺序变化带来的错位)
INSERT INTO automation_tasks_new
  (id, name, prompt, column_id, tags_json, cover_mode, cover_prompt, cover_url,
   publish_mode, recurrence, time_of_day, weekday, day_of_month, start_date,
   end_date, enabled, next_run_at, last_run_at, last_status, last_error,
   last_post_id, created_by, created_by_name, created_at, updated_at)
SELECT
   id, name, prompt, column_id, tags_json, cover_mode, cover_prompt, cover_url,
   publish_mode, recurrence, time_of_day, weekday, day_of_month, start_date,
   end_date, enabled, next_run_at, last_run_at, last_status, last_error,
   last_post_id, created_by, created_by_name, created_at, updated_at
  FROM automation_tasks;

-- 4. 删除旧表(会级联清空 automation_runs)并换成新表
DROP TABLE automation_tasks;
ALTER TABLE automation_tasks_new RENAME TO automation_tasks;

-- 5. 恢复运行记录(先清空,兼容「级联未生效」的环境,避免主键冲突)
DELETE FROM automation_runs;
INSERT INTO automation_runs
  (id, task_id, status, message, post_id, post_slug, cover_url,
   started_at, finished_at, created_at)
SELECT
   id, task_id, status, message, post_id, post_slug, cover_url,
   started_at, finished_at, created_at
  FROM automation_runs_backup;
DROP TABLE automation_runs_backup;

-- 6. 重建索引与触发器(DROP TABLE 时会被一并删除)
CREATE INDEX IF NOT EXISTS idx_automation_due ON automation_tasks (enabled, next_run_at);

CREATE TRIGGER IF NOT EXISTS trg_automation_tasks_touch
AFTER UPDATE ON automation_tasks
WHEN new.updated_at = old.updated_at
BEGIN
  UPDATE automation_tasks SET updated_at = datetime('now') WHERE id = new.id;
END;