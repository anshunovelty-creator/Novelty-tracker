-- ============================================================
-- 014_prepress_stage_rename.sql
-- Prepress asked for four steps instead of three:
--
--   PO Received  →  Artwork Pending  →  Plate Status  →  Job Card Done
--
-- Two changes to stored data:
--   'Artwork Received'        →  'Artwork Pending'   (rename in place)
--   'Prepress / Design Check' →  'Job Card Done'     (retired; it was the
--                                                     last prepress step, so
--                                                     that is the equivalent)
--
-- 'Plate Status' is genuinely new — no existing row can hold it, so nothing
-- migrates into it.
--
-- Stage names are stored as free TEXT (no CHECK constraint enumerates them),
-- so this is a pure data migration. Without it, every job left on an old
-- value would render as a stage the application no longer knows.
--
-- Note on meaning: 'Artwork Received' asserted the artwork had ARRIVED;
-- 'Artwork Pending' reads as the opposite. Confirmed as intended — the stage
-- is treated as "the artwork step" on a checklist, not as a claim about
-- artwork having been received.
-- ============================================================

-- Three columns carry stage names. All three must move together or the job
-- timeline stops agreeing with the job's current status.

-- 1. Current status of each job
UPDATE jobs
   SET status = 'Artwork Pending'
 WHERE status = 'Artwork Received';

UPDATE jobs
   SET status = 'Job Card Done'
 WHERE status = 'Prepress / Design Check';

-- 2. Completed-stage stamps (drive the ✓ marks in the stage picker).
--    A job that completed BOTH old stages would collide on the
--    (job_id, stage) unique key when both map forward, so the losing row is
--    dropped first — the surviving stamp keeps the earlier completed_at,
--    which is the honest timestamp for "prepress was finished".
DELETE FROM job_stage_timestamps t
 WHERE t.stage = 'Prepress / Design Check'
   AND EXISTS (
     SELECT 1 FROM job_stage_timestamps t2
      WHERE t2.job_id = t.job_id
        AND t2.stage  = 'Job Card Done'
   );

UPDATE job_stage_timestamps
   SET stage = 'Artwork Pending'
 WHERE stage = 'Artwork Received';

UPDATE job_stage_timestamps
   SET stage = 'Job Card Done'
 WHERE stage = 'Prepress / Design Check';

-- 3. Audit log. Rewritten too, so history reads in today's vocabulary
--    rather than showing stages that no longer exist anywhere in the UI.
UPDATE job_status_logs
   SET status = 'Artwork Pending'
 WHERE status = 'Artwork Received';

UPDATE job_status_logs
   SET status = 'Job Card Done'
 WHERE status = 'Prepress / Design Check';
