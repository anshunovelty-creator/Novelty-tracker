-- ============================================================
-- Realtime for the admin header badges
-- ============================================================
-- The BOM badge (pending material requests) and the Dispatch Emails badge
-- (parties waiting on a dispatch email) now update from Supabase Realtime
-- instead of a 60s poll — see src/hooks/useBadgeCounts.ts. Realtime only
-- streams tables that are in the supabase_realtime publication, so both
-- backing tables join it here, the same idempotent way 010/059/061 did for
-- prepress_todos, messages and stage_comments.
--
-- No policy changes. Realtime delivers a row only to sessions that can
-- SELECT it, and both tables already have exactly the right authenticated
-- SELECT policy, mirroring the API gates:
--   bom_material_requests           dept_has_permission('bom_use')           (014)
--   pending_dispatch_notifications  dept_has_permission('dispatch_notifications') (013)
-- The client never reads the payload anyway — any event just triggers a
-- refetch of the server-computed count.
--
-- Until this runs the badges still work: the channel simply never fires
-- and the 2-minute fallback poll plus refetch-on-focus keep them current.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'bom_material_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE bom_material_requests;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'pending_dispatch_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE pending_dispatch_notifications;
  END IF;
END $$;
