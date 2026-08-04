-- ============================================================
-- 018_slitting_confirmation.sql
-- Fixes a race in the Slitting → Quality Check handoff.
--
-- jobs.status flips to 'Slitting' automatically the instant Production
-- clicks Complete on the machine board (advanceJobStageFromMachine writes
-- jobs.status AND job_stage_timestamps in one call, with no Postpress
-- action involved at all). The Quality Check prerequisite check used to
-- treat "job.status === 'Slitting'" as proof the stage was done — true for
-- every other stage in the pipeline, where the owning department's own
-- click IS their completion signal, but false here since Postpress never
-- clicked anything. QC could jump ahead while slitting was still in
-- progress on the floor.
--
-- slitting_confirmed_at is the real completion signal: set when Postpress
-- (or Admin) explicitly confirms, either via the manual status dropdown
-- (status/route.ts sets it automatically on that path — a deliberate
-- department action is still a real confirmation) or, for the machine-board
-- path, via the dedicated POST /api/jobs/[id]/confirm-slitting endpoint.
-- ============================================================

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS slitting_confirmed_at TIMESTAMPTZ;

COMMENT ON COLUMN jobs.slitting_confirmed_at IS
  'Set when Postpress (or Admin) confirms slitting is physically done. Gates the Quality Check prerequisite — see status/route.ts and confirm-slitting/route.ts.';
