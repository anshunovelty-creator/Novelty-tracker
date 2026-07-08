-- ============================================================
-- NOVELTY LABELS JOB TRACKING SYSTEM
-- Migration 005: realign print_runs.current_stage with the app vocabulary
-- Run AFTER 004_client_view_print_runs.sql
-- ============================================================
-- The live database had drifted from migration 003: print_runs.current_stage
-- was defaulting to 'In Printing' (the 15-stage job pipeline vocabulary) and
-- its CHECK constraint rejected 'Printing'. The print-run code (PrintRunStage
-- type, HistoryPanel stage maps, the stage-advance API) only understands the
-- 4-value run vocabulary: Printing -> QC -> Packing -> Dispatched. A run row
-- stored as 'In Printing' crashed the admin page.
--
-- This migration converts existing data and restores the constraint/default
-- to match 003. Idempotent: safe to run if already aligned.
-- ============================================================

-- Drop the (drifted) constraint so existing rows can be normalized.
ALTER TABLE print_runs DROP CONSTRAINT IF EXISTS print_runs_current_stage_check;

-- Normalize legacy job-vocabulary values to the run vocabulary.
-- Only 'In Printing' is known to exist; the rest are mapped defensively.
-- 'Slitting' sits between In Printing and Quality Check in the job pipeline,
-- so a run parked there has not reached QC yet → 'Printing'.
UPDATE print_runs SET current_stage = 'Printing'   WHERE current_stage IN ('In Printing', 'Slitting');
UPDATE print_runs SET current_stage = 'QC'         WHERE current_stage = 'Quality Check';
UPDATE print_runs SET current_stage = 'Packing'    WHERE current_stage = 'Ready to Dispatch';
-- 'Dispatched' is identical in both vocabularies; no change needed.

-- Catch-all: any value still outside the run vocabulary falls back to
-- 'Printing' (the earliest run stage, so the run stays advanceable). This
-- guarantees the ADD CONSTRAINT below cannot fail mid-migration on a value
-- we did not anticipate. Expected to touch zero rows.
UPDATE print_runs SET current_stage = 'Printing'
  WHERE current_stage NOT IN ('Printing', 'QC', 'Packing', 'Dispatched');

-- Restore the default and constraint exactly as declared in migration 003.
ALTER TABLE print_runs ALTER COLUMN current_stage SET DEFAULT 'Printing';
ALTER TABLE print_runs ADD CONSTRAINT print_runs_current_stage_check
  CHECK (current_stage IN ('Printing', 'QC', 'Packing', 'Dispatched'));
