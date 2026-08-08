-- ============================================================
-- 024_prepress_todos.sql
-- Shared reminder checklist for the Prepress team, surfaced as an
-- always-visible panel on the Job Separation worksheet. Anyone in
-- Prepress (or Admin) can add a task; checking it off deletes the row
-- outright — there is no "done" state to track, a completed task is
-- simply gone.
-- ============================================================

CREATE TABLE IF NOT EXISTS prepress_todos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task        TEXT NOT NULL,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Oldest task first — a running list reads top-to-bottom like a queue.
CREATE INDEX IF NOT EXISTS idx_prepress_todos_created_at
  ON prepress_todos (created_at);

-- ── Row Level Security ────────────────────────────────────────
-- Mirrors parties: authenticated staff read, writes go through the
-- service-role admin client in the API layer, where the Prepress/Admin
-- gate lives.
ALTER TABLE prepress_todos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prepress_todos_select_authenticated" ON prepress_todos;
CREATE POLICY "prepress_todos_select_authenticated"
  ON prepress_todos FOR SELECT
  TO authenticated
  USING (true);

