-- ============================================================
-- 028_prepress_todo_logs.sql
-- Audit trail for the Prepress checklist (024_prepress_todos, 026
-- mark-read): who added, completed/reopened, edited, and deleted each
-- task. A separate table rather than a soft-delete flag on
-- prepress_todos, because deleting a task must still leave a
-- permanent record — the row itself is gone, so the task text is
-- snapshotted here at the time of each action.
-- ============================================================

CREATE TABLE IF NOT EXISTS prepress_todo_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  todo_id           UUID,
  task              TEXT NOT NULL,
  action            TEXT NOT NULL CHECK (action IN ('created', 'completed', 'reopened', 'edited', 'deleted')),
  actor_department  TEXT,
  actor_email       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Newest first — a history reads top-to-bottom like an activity feed.
CREATE INDEX IF NOT EXISTS idx_prepress_todo_logs_created_at
  ON prepress_todo_logs (created_at DESC);

-- ── Row Level Security ────────────────────────────────────────
-- Mirrors prepress_todos: authenticated staff read, writes go through
-- the service-role admin client in the API layer, where the
-- Prepress/Admin gate lives.
ALTER TABLE prepress_todo_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prepress_todo_logs_select_authenticated" ON prepress_todo_logs;
CREATE POLICY "prepress_todo_logs_select_authenticated"
  ON prepress_todo_logs FOR SELECT
  TO authenticated
  USING (true);
