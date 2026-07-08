-- ============================================================
-- NOVELTY LABELS JOB TRACKING SYSTEM
-- Migration 006: reconcile print-run stage vocabulary + apply the
--                client_job_view columns that migration 004 added.
-- Run AFTER 005_fix_print_run_stage_vocab.sql
-- ============================================================
-- Two drifts are fixed here:
--
-- 1. print_run_stage_logs.stage had NO check constraint and held legacy
--    job-pipeline values (In Printing / Slitting / Quality Check / Packing /
--    Ready to Dispatch / Dispatched). The app code, types, and the stage API
--    all use the 4-value run vocabulary: Printing -> QC -> Packing ->
--    Dispatched. We MAP every legacy row into that vocabulary (the logs are a
--    permanent append-only audit trail — nothing is deleted) and add a CHECK
--    constraint so the column can never drift again. Mapping is display-safe:
--    the tracking UI shows the EARLIEST timestamp per stage, and each mapped
--    stage ('Slitting' -> 'Printing', 'Ready to Dispatch' -> 'Packing') is
--    always logged after its target stage, so displayed times do not shift.
--
-- 2. client_job_view on the live DB was never updated by migration 004, so it
--    is missing total_qty_dispatched and has_partial_runs. We re-apply that
--    view definition here (CREATE OR REPLACE is idempotent).
--
-- Idempotent: safe to run more than once.
-- ============================================================

-- ── 1. Reconcile print_run_stage_logs to the 4-value run vocabulary ──
-- 'Packing' and 'Dispatched' already match. 'Slitting' happens during the
-- printing phase and 'Ready to Dispatch' during the packing phase, so their
-- rows are absorbed into those stages rather than deleted — the audit trail
-- stays complete. A run may end up with duplicate rows for a stage; that is
-- fine (no uniqueness constraint, and the UI takes the earliest per stage).
UPDATE print_run_stage_logs SET stage = 'Printing' WHERE stage IN ('In Printing', 'Slitting');
UPDATE print_run_stage_logs SET stage = 'QC'       WHERE stage = 'Quality Check';
UPDATE print_run_stage_logs SET stage = 'Packing'  WHERE stage = 'Ready to Dispatch';

-- Catch-all: absorb any unanticipated legacy value into 'Printing' so the
-- ADD CONSTRAINT below cannot fail mid-migration. Expected to touch zero rows.
UPDATE print_run_stage_logs SET stage = 'Printing'
  WHERE stage NOT IN ('Printing', 'QC', 'Packing', 'Dispatched');

ALTER TABLE print_run_stage_logs DROP CONSTRAINT IF EXISTS print_run_stage_logs_stage_check;
ALTER TABLE print_run_stage_logs ADD CONSTRAINT print_run_stage_logs_stage_check
  CHECK (stage IN ('Printing', 'QC', 'Packing', 'Dispatched'));

-- ── 2. Re-apply migration 004's client_job_view (in case it was never run) ──
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
  j.total_qty_dispatched,
  j.has_partial_runs
FROM jobs j;
