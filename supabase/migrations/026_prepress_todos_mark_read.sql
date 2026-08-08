-- ============================================================
-- 026_prepress_todos_mark_read.sql
-- Adds a "mark as read" state between adding a task and deleting it.
-- Previously checking a task off deleted it outright (see 024); now
-- marking it read just flags it (the panel shows it green) so the rest
-- of the team can see it's been actioned and verify it before someone
-- deletes it for good. Nullable timestamp, not a boolean, to match the
-- rest of the schema's "when did this happen" state markers (e.g.
-- jobs.slitting_confirmed_at) — null means still pending.
-- ============================================================

ALTER TABLE prepress_todos
  ADD COLUMN IF NOT EXISTS marked_read_at TIMESTAMPTZ;
