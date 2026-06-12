-- ============================================================
-- NOVELTY LABELS JOB TRACKING SYSTEM
-- Migration 004: expose print-run columns to the client portal
-- Run AFTER 003_print_runs.sql
-- ============================================================
-- client_job_view (created in 001) lists columns explicitly, so
-- the columns added in 003 are invisible to the portal until the
-- view is recreated. CREATE OR REPLACE appends them at the end.
-- Existing grants on the view are preserved.
-- ============================================================

CREATE OR REPLACE VIEW client_job_view AS
SELECT
  j.id,
  j.po_number,
  j.pm_code,
  j.party,
  j.job_name,
  j.label_qty,
  j.po_date,
  j.delivery_date,
  j.status,
  j.job_type,
  j.urgent,
  j.urgent_priority,
  j.notes,
  j.dispatched_qty,
  j.remaining_qty,
  j.halt_remark,
  j.qc_remark,
  j.is_scheduled_release,
  j.is_closed,
  j.created_at,
  j.updated_at,
  j.total_qty_dispatched,   -- new in 003
  j.has_partial_runs        -- new in 003
FROM jobs j;
