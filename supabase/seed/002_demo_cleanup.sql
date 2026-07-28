-- ============================================================
-- REMOVE ALL DEMO DATA
-- Run this after the presentation to return the database to real jobs only.
--
-- HOW TO RUN: Supabase Dashboard → SQL Editor → New Query → paste → Run
--
-- Only rows whose po_number starts with 'DEMO-' are touched. Real POs are
-- never matched. Deleting the job cascades to job_stage_timestamps,
-- job_status_logs and stage_comments via ON DELETE CASCADE — which is also
-- the only way those audit rows can be removed, since job_status_logs has
-- no DELETE policy by design (permanent audit trail).
-- ============================================================

-- Look before deleting: confirm the count and that nothing real is caught.
SELECT COUNT(*) AS demo_jobs_to_delete
FROM jobs
WHERE po_number LIKE 'DEMO-%';

-- Then run the delete.
DELETE FROM jobs WHERE po_number LIKE 'DEMO-%';

-- Confirm: expect 0.
SELECT COUNT(*) AS demo_jobs_remaining
FROM jobs
WHERE po_number LIKE 'DEMO-%';
