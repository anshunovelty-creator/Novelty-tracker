-- ============================================================
-- NOVELTY LABELS JOB TRACKING SYSTEM
-- Migration 043: allow Dispatch/Admin to delete a queued dispatch entry
-- ============================================================
-- Pairs with the existing SELECT/UPDATE policies from migration 038 —
-- lets a mistaken entry (manual or job-triggered) be removed from the
-- pending-dispatch-email queue before it goes out.
-- ============================================================

CREATE POLICY "Dispatch/Admin can delete pending dispatch notifications"
  ON pending_dispatch_notifications FOR DELETE
  TO authenticated
  USING (current_dept() IN ('Dispatch', 'Admin'));
