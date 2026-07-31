-- ============================================================
-- PRODUCTION RESET — DELETE EVERY JOB
--
-- Run ONCE, before the team starts entering real work. This empties
-- the jobs table completely: open, halted, dispatched, PO-closed,
-- scheduled-release — everything, with no PO-number filter.
--
-- HOW TO RUN: Supabase Dashboard → SQL Editor → New Query → paste → Run
-- (The SQL Editor runs as the table owner, so RLS is bypassed. From
-- an authenticated app session this would fail — job_status_logs and
-- friends have no DELETE policy on purpose.)
--
-- THIS IS NOT REVERSIBLE. Take a backup first:
--   Dashboard → Database → Backups
--
-- WHAT IT DELETES (all via ON DELETE CASCADE from jobs):
--   jobs
--     ├─ job_stage_timestamps      stage completion records
--     ├─ job_status_logs           permanent audit trail
--     ├─ stage_comments            internal per-stage threads
--     ├─ dispatch_schedules        scheduled-release plans
--     ├─ on_time_dispatch_log      on-time % analytics history
--     ├─ machine_queue_items       machine queues + run history
--     └─ print_runs
--          └─ print_run_stage_logs
--   job_card_counters              reset separately — see step 3
--
-- WHAT IT KEEPS (master data — not job records):
--   machines, printing_units, party_contacts, auth.users
-- ============================================================


-- ── STEP 1: LOOK BEFORE YOU DELETE ───────────────────────────
-- Run this on its own first. Confirm the numbers match what you
-- expect to lose. If anything here surprises you, stop.
SELECT
  (SELECT COUNT(*) FROM jobs)                     AS jobs_total,
  (SELECT COUNT(*) FROM jobs WHERE is_closed)     AS jobs_closed,
  (SELECT COUNT(*) FROM jobs WHERE NOT is_closed) AS jobs_open,
  (SELECT COUNT(*) FROM job_status_logs)          AS audit_log_rows,
  (SELECT COUNT(*) FROM print_runs)               AS print_runs,
  (SELECT COUNT(*) FROM machine_queue_items)      AS machine_queue_rows,
  (SELECT COUNT(*) FROM on_time_dispatch_log)     AS on_time_rows,
  (SELECT COUNT(*) FROM machines)                 AS machines_kept,
  (SELECT COUNT(*) FROM printing_units)           AS printing_units_kept,
  (SELECT COUNT(*) FROM party_contacts)           AS party_contacts_kept;


-- ── STEP 2 + 3: THE RESET ────────────────────────────────────
-- Wrapped in a transaction so the wipe and the counter reset either
-- both land or neither does. A half-applied reset would leave the
-- counter high and number the first real job jul26-48 in an empty shop.
BEGIN;

  -- Step 2: every job, no filter. Cascades do the rest.
  DELETE FROM jobs;

  -- Step 3: restart job card numbering at 1.
  --
  -- job_card_counters has no FK to jobs, so nothing above touches it.
  -- Left alone it keeps its last_seq, and the first job the team
  -- enters would continue from wherever the old data stopped instead
  -- of jul26-1. Clearing every period row makes the trigger's UPSERT
  -- insert a fresh row starting at 1 for whichever month is current.
  DELETE FROM job_card_counters;

COMMIT;


-- ── STEP 4: CONFIRM ──────────────────────────────────────────
-- Every job count must be 0, and the master-data counts unchanged
-- from step 1.
SELECT
  (SELECT COUNT(*) FROM jobs)                  AS jobs,
  (SELECT COUNT(*) FROM job_stage_timestamps)  AS stage_timestamps,
  (SELECT COUNT(*) FROM job_status_logs)       AS status_logs,
  (SELECT COUNT(*) FROM stage_comments)        AS stage_comments,
  (SELECT COUNT(*) FROM dispatch_schedules)    AS dispatch_schedules,
  (SELECT COUNT(*) FROM on_time_dispatch_log)  AS on_time_log,
  (SELECT COUNT(*) FROM machine_queue_items)   AS machine_queue,
  (SELECT COUNT(*) FROM print_runs)            AS print_runs,
  (SELECT COUNT(*) FROM print_run_stage_logs)  AS print_run_logs,
  (SELECT COUNT(*) FROM job_card_counters)     AS card_counters,
  -- these should NOT be zero
  (SELECT COUNT(*) FROM machines)              AS machines_kept,
  (SELECT COUNT(*) FROM printing_units)        AS printing_units_kept,
  (SELECT COUNT(*) FROM party_contacts)        AS party_contacts_kept;


-- ============================================================
-- OPTIONAL — client contact list
--
-- party_contacts is keyed on the party name with no FK to jobs, so
-- it survives the wipe. That is usually what you want: the email and
-- WhatsApp numbers the notification routes read are real client data
-- worth keeping.
--
-- Uncomment ONLY if the contact list is also demo/test data:
-- ============================================================
-- DELETE FROM party_contacts;
