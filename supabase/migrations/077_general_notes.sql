-- ============================================================
-- 077_general_notes.sql
-- Internal notes no longer have to name a job. The Notes drawer's composer
-- now defaults to "No job" (a team-wide note); picking a job files the note
-- on that job at its current stage, as before.
--
-- A general note is a stage_comments row with job_id and stage both NULL.
-- Every job-scoped read filters by job_id, so these never show up in a
-- job's history; only the Notes feed (GET /api/notes/feed) lists them.
-- Backward compatible: existing rows and writers are untouched.
-- ============================================================

ALTER TABLE stage_comments ALTER COLUMN job_id DROP NOT NULL;
ALTER TABLE stage_comments ALTER COLUMN stage  DROP NOT NULL;

-- A note is either general (no job, no stage) or on a job at a stage.
ALTER TABLE stage_comments
  ADD CONSTRAINT stage_comments_job_stage_together
  CHECK ((job_id IS NULL) = (stage IS NULL));
