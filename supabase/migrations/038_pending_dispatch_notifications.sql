-- ============================================================
-- NOVELTY LABELS JOB TRACKING SYSTEM
-- Migration 038: pending_dispatch_notifications table
-- ============================================================
-- Jobs are marked Dispatched/Partial Dispatch one-by-one (bulk stage-advance
-- is deliberately not supported), but a single truck run often carries
-- several orders for the same party. Rather than firing one email per job,
-- each dispatch event queues a row here; Dispatch/Admin then sends one
-- consolidated email per party from /admin/dispatch-notifications whenever
-- a batch (e.g. a truck load) is complete. See POST /api/dispatch-notifications/send.
-- ============================================================

CREATE TABLE pending_dispatch_notifications (
  id          UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id      UUID    NOT NULL,
  job_name    TEXT,
  po_number   TEXT    NOT NULL,
  party       TEXT    NOT NULL,
  status      TEXT    NOT NULL,   -- 'Partial Dispatch' | 'Dispatched'
  qty         INTEGER,
  remark      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at TIMESTAMPTZ          -- NULL = still pending; set once the consolidated email is sent
);

-- Primary lookup pattern: WHERE party = $1 AND notified_at IS NULL
CREATE INDEX idx_pending_dispatch_notifications_pending
  ON pending_dispatch_notifications (party)
  WHERE notified_at IS NULL;

ALTER TABLE pending_dispatch_notifications ENABLE ROW LEVEL SECURITY;

-- Dispatch owns marking jobs Dispatched, so they own sending the resulting
-- notification too; Admin always has full access. Mirrors STOCK_EDIT_DEPTS.
CREATE POLICY "Dispatch/Admin can read pending dispatch notifications"
  ON pending_dispatch_notifications FOR SELECT
  TO authenticated
  USING (current_dept() IN ('Dispatch', 'Admin'));

CREATE POLICY "Dispatch/Admin can update pending dispatch notifications"
  ON pending_dispatch_notifications FOR UPDATE
  TO authenticated
  USING (current_dept() IN ('Dispatch', 'Admin'));

-- No authenticated INSERT policy — rows are only ever written by
-- /api/jobs/[id]/status via the service-role client.
