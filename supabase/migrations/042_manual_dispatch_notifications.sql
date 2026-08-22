-- ============================================================
-- NOVELTY LABELS JOB TRACKING SYSTEM
-- Migration 042: manual (free-text) dispatch notification entries
-- ============================================================
-- Some dispatches happen outside the normal Job Separation flow (hand
-- delivered, or the status update was missed) and never queue a row via
-- POST /api/jobs/[id]/status. This lets Dispatch/Admin add a free-text
-- entry directly from /admin/dispatch-notifications so it still goes out
-- in the next consolidated email for that party. These rows carry no
-- job_id since there's no backing job row to point at.
-- ============================================================

ALTER TABLE pending_dispatch_notifications
  ALTER COLUMN job_id DROP NOT NULL;

-- Manual entries are inserted from the browser (authenticated session),
-- unlike the service-role insert from the status route.
CREATE POLICY "Dispatch/Admin can insert pending dispatch notifications"
  ON pending_dispatch_notifications FOR INSERT
  TO authenticated
  WITH CHECK (current_dept() IN ('Dispatch', 'Admin'));
