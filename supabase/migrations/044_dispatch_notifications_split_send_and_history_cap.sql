-- ============================================================
-- NOVELTY LABELS JOB TRACKING SYSTEM
-- Migration 044: split internal/party dispatch sends, cap sent history
-- ============================================================
-- The team wants to notify the internal team first, then send the
-- party's email some time later (not atomically together as before), so
-- POST /api/dispatch-notifications/send now takes a `target` of 'internal'
-- or 'party' and marks each independently. A row only leaves the pending
-- queue once its PARTY email goes out (notified_at) — internal_notified_at
-- is bookkeeping only and does not affect what GET /api/dispatch-notifications
-- returns.
--
-- Sent rows aren't deleted immediately (their email is retrievable from the
-- inbox), but there's no reason to keep growing the table forever — this
-- trigger keeps at most the 100 most-recently-sent rows, deleting older
-- ones automatically whenever a new row is marked sent.
-- ============================================================

ALTER TABLE pending_dispatch_notifications
  ADD COLUMN internal_notified_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION trim_dispatch_notification_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM pending_dispatch_notifications
  WHERE notified_at IS NOT NULL
    AND id NOT IN (
      SELECT id FROM pending_dispatch_notifications
      WHERE notified_at IS NOT NULL
      ORDER BY notified_at DESC
      LIMIT 100
    );
  RETURN NULL;
END;
$$;

CREATE TRIGGER trim_dispatch_notification_history_trigger
  AFTER UPDATE OF notified_at ON pending_dispatch_notifications
  FOR EACH STATEMENT
  EXECUTE FUNCTION trim_dispatch_notification_history();
