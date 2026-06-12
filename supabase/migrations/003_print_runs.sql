-- ============================================================
-- NOVELTY LABELS JOB TRACKING SYSTEM
-- Migration 003: Partial Print Runs (multi-cycle large orders)
-- Run AFTER 001_initial_schema.sql and 002_party_contacts.sql
-- ============================================================
-- Large orders are printed/dispatched in multiple cycles. Each
-- cycle (print run) moves through Printing → QC → Packing →
-- Dispatched independently. Prepress happens once per job, not
-- per run.
-- ============================================================


-- ============================================================
-- TABLE: print_runs
-- One row per print cycle of a job.
-- ============================================================
CREATE TABLE print_runs (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id               UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  run_number           INTEGER NOT NULL,        -- 1, 2, 3… auto-assigned per job (trigger below)
  qty_this_run         INTEGER NOT NULL CHECK (qty_this_run > 0),
  qty_remaining_after  INTEGER NOT NULL CHECK (qty_remaining_after >= 0),
  current_stage        TEXT NOT NULL DEFAULT 'Printing'
                         CHECK (current_stage IN ('Printing', 'QC', 'Packing', 'Dispatched')),
  status               TEXT NOT NULL DEFAULT 'in_progress'
                         CHECK (status IN ('in_progress', 'dispatched')),
  started_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dispatched_at        TIMESTAMPTZ,             -- NULL until this run is dispatched
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, run_number)                   -- one row per run per job
);

CREATE INDEX idx_print_runs_job_id ON print_runs (job_id);
CREATE INDEX idx_print_runs_status ON print_runs (job_id, status);


-- ============================================================
-- TRIGGER: auto-assign run_number per job (1, 2, 3…)
-- Application may omit run_number; the trigger fills the next
-- number for that job. Explicit values are kept if provided.
-- ============================================================
CREATE OR REPLACE FUNCTION trigger_set_print_run_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.run_number IS NULL THEN
    SELECT COALESCE(MAX(run_number), 0) + 1
      INTO NEW.run_number
      FROM print_runs
     WHERE job_id = NEW.job_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_print_run_number
  BEFORE INSERT ON print_runs
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_print_run_number();

-- run_number must be NOT NULL after the trigger fires, but the column
-- itself allows the INSERT to arrive without it. Enforce via constraint
-- trigger order: NOT NULL is declared on the column, and Postgres checks
-- column constraints AFTER BEFORE-triggers run — so this is safe.


-- ============================================================
-- TABLE: print_run_stage_logs
-- Append-only audit of every stage change per run.
-- ============================================================
CREATE TABLE print_run_stage_logs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  print_run_id  UUID NOT NULL REFERENCES print_runs(id) ON DELETE CASCADE,
  stage         TEXT NOT NULL,
  changed_by    UUID REFERENCES auth.users(id),
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes         TEXT
);

CREATE INDEX idx_prsl_print_run_id ON print_run_stage_logs (print_run_id);


-- ============================================================
-- JOBS TABLE: new columns
-- total_qty_dispatched — cumulative qty dispatched via print runs
-- has_partial_runs     — true once a run is created with qty remaining
-- NOTE: jobs.dispatched_qty (synced by trigger from migration 001)
-- remains in place for the classic Partial Dispatch flow. A job uses
-- ONE flow or the other — enforced in the application layer.
-- ============================================================
ALTER TABLE jobs ADD COLUMN total_qty_dispatched INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN has_partial_runs     BOOLEAN NOT NULL DEFAULT FALSE;


-- ============================================================
-- ROW LEVEL SECURITY
-- Pattern matches 001_initial_schema.sql:
--   SELECT       → all authenticated users
--   INSERT       → all authenticated users (dept rules enforced in app layer)
--   UPDATE       → all authenticated users (stage progression validated in API)
--   DELETE       → Admin only
-- Logs are append-only: no UPDATE/DELETE policies at all.
-- ============================================================

ALTER TABLE print_runs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE print_run_stage_logs ENABLE ROW LEVEL SECURITY;

-- ── print_runs ────────────────────────────────────────────────

CREATE POLICY "Authenticated users can read print runs"
  ON print_runs FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "Authenticated users can insert print runs"
  ON print_runs FOR INSERT
  TO authenticated
  WITH CHECK (TRUE);

CREATE POLICY "Authenticated users can update print runs"
  ON print_runs FOR UPDATE
  TO authenticated
  USING (TRUE);

CREATE POLICY "Admin can delete print runs"
  ON print_runs FOR DELETE
  TO authenticated
  USING (current_dept() = 'Admin');

-- ── print_run_stage_logs (append-only audit trail) ────────────

CREATE POLICY "Authenticated users can read print run logs"
  ON print_run_stage_logs FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "Authenticated users can insert print run logs"
  ON print_run_stage_logs FOR INSERT
  TO authenticated
  WITH CHECK (TRUE);

-- NO update or delete policies on logs — permanent audit trail.


-- ============================================================
-- CLIENT PORTAL ACCESS
-- The tracking portal (anon key) shows run progress per job:
--   "Run 1: 20,000 labels — Delivered"
-- Anon may read print_runs (the UI never displays notes).
-- Stage logs stay internal — no anon access.
-- ============================================================

GRANT SELECT ON print_runs TO anon;

CREATE POLICY "Anonymous can read print runs"
  ON print_runs FOR SELECT
  TO anon
  USING (TRUE);


-- ============================================================
-- Done. Next: TypeScript types (Step 2).
-- ============================================================
