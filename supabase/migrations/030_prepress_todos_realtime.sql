-- ============================================================
-- 030_prepress_todos_realtime.sql
-- Adds prepress_todos to the supabase_realtime publication so the
-- To-Do panel can subscribe to postgres_changes as a lightweight
-- "something changed" signal, instead of polling. Safe to enable here
-- (unlike machines/machine_queue_items — see
-- room-display-refresh-is-polled-not-realtime memory) because
-- prepress_todos already has a fully open SELECT policy for
-- `authenticated` (024_prepress_todos.sql): Realtime delivers changes
-- through RLS, and that policy already exposes every row to every
-- logged-in staff member, so this adds no new data exposure.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'prepress_todos'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE prepress_todos;
  END IF;
END $$;
