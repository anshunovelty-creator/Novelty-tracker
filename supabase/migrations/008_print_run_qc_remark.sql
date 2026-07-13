-- 008_print_run_qc_remark.sql
-- ============================================================
-- Scheduled releases: QC works per release, so the QC remark
-- belongs on the print run, not only on the job.
-- Written when QC advances a run out of the QC stage.
-- ============================================================

ALTER TABLE print_runs ADD COLUMN IF NOT EXISTS qc_remark TEXT;

COMMENT ON COLUMN print_runs.qc_remark IS
  'Optional QC remark for this run/release, captured when QC advances the run past the QC stage.';
