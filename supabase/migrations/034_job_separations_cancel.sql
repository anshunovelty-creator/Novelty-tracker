-- ============================================================
-- 034_job_separations_cancel.sql
-- Replaces hard delete with a Cancel action: the row (and its Sr. No.)
-- stays visible forever, struck through and marked with why it was
-- cancelled, instead of disappearing and leaving the number unexplained.
-- Cancelling is one-way — there is no un-cancel column or endpoint.
-- ============================================================

ALTER TABLE job_separations
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by TEXT,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
