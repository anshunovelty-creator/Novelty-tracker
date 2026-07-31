-- ============================================================
-- 015_postpress_department.sql
-- Adds the Postpress department.
--
-- Slitting moves off Production and onto Postpress; Production is now
-- printing only. The stage list itself is unchanged — this is purely about
-- who is allowed to set 'Slitting'.
--
-- The only database-side change is the department CHECK on job_status_logs
-- (001_initial_schema.sql). Without widening it, a Postpress user could
-- change a stage in the UI and the audit-log insert would fail behind them.
--
-- No rows are rewritten: nothing can already be 'Postpress'.
--
-- The client-safe view (client_status_log) renders departments as
-- `changed_by_dept || ' Team'`, so Postpress reads as "Postpress Team" on
-- the tracking portal with no change needed here.
-- ============================================================

-- Inline CHECKs get the auto-generated name <table>_<column>_check.
ALTER TABLE job_status_logs
  DROP CONSTRAINT IF EXISTS job_status_logs_changed_by_dept_check;

ALTER TABLE job_status_logs
  ADD CONSTRAINT job_status_logs_changed_by_dept_check
  CHECK (changed_by_dept IN (
    'Prepress',
    'QC',
    'Production',
    'Postpress',
    'Dispatch',
    'Admin'
  ));


-- ── Creating the Postpress user ───────────────────────────────
-- Departments live in auth user metadata, not in a table, so there is no
-- row to insert here. Create the account in the Supabase dashboard
-- (Authentication → Users) with:
--
--   { "department": "Postpress", "display_name": "Postpress Team" }
--
-- parseDepartment() rejects any other spelling, so the value must match
-- 'Postpress' exactly — a user with a typo'd department cannot sign in to
-- anything useful.
