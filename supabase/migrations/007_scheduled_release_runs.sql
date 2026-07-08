-- ============================================================
-- NOVELTY LABELS JOB TRACKING SYSTEM
-- Migration 007: scheduled releases become print runs.
-- Run AFTER 006_reconcile_print_run_vocab.sql
-- ============================================================
-- Scheduled-release jobs dispatch in multiple releases, and each release
-- goes through the full production process (only the one-time prepress /
-- approval steps are shared). Two changes make that work:
--
-- 1. The per-run pipeline grows from 4 to 6 stages, mirroring every
--    non-prepress job stage:
--      Printing -> Slitting -> QC -> Packing -> Ready to Dispatch -> Dispatched
--    Existing rows (4-value vocabulary) remain valid — the new values are a
--    superset, so no data conversion is needed.
--
-- 2. print_runs.schedule_id links a run to the dispatch_schedules row it
--    fulfils. A schedule is the PLANNING record (release number, planned
--    date/qty); the run is the EXECUTION record. At most one run per
--    schedule (partial unique index). Runs on non-scheduled jobs keep
--    schedule_id NULL.
--
-- Idempotent: safe to run more than once.
-- ============================================================

-- ── 1. Extend the run-stage vocabulary to 6 values ──
ALTER TABLE print_runs DROP CONSTRAINT IF EXISTS print_runs_current_stage_check;
ALTER TABLE print_runs ADD CONSTRAINT print_runs_current_stage_check
  CHECK (current_stage IN ('Printing', 'Slitting', 'QC', 'Packing', 'Ready to Dispatch', 'Dispatched'));

ALTER TABLE print_run_stage_logs DROP CONSTRAINT IF EXISTS print_run_stage_logs_stage_check;
ALTER TABLE print_run_stage_logs ADD CONSTRAINT print_run_stage_logs_stage_check
  CHECK (stage IN ('Printing', 'Slitting', 'QC', 'Packing', 'Ready to Dispatch', 'Dispatched'));

-- ── 2. Link runs to the schedule they fulfil ──
ALTER TABLE print_runs ADD COLUMN IF NOT EXISTS schedule_id UUID
  REFERENCES dispatch_schedules(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_print_runs_schedule_id
  ON print_runs (schedule_id) WHERE schedule_id IS NOT NULL;
