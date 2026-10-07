-- ============================================================
-- 072_job_status_requests.sql
-- One row per stage change that carried an Idempotency-Key, so the same
-- change can never be applied twice.
--
-- Why: on a dropped connection the browser can't tell "never arrived" from
-- "arrived, but the answer was lost". The dashboard keeps the change on the
-- device and replays it later (lib/offlineQueue.ts) — and a replayed Partial
-- Dispatch would count its quantity again and queue a second party email.
-- The key is made once, before the first try, and travels with the replay;
-- POST /api/jobs/[id]/status claims it here first and answers a repeat with
-- the job as it stands instead of applying it again.
--
-- Server-only: written with the service role. RLS is on with no policies,
-- so the browser's anon/authenticated roles can neither read nor write it.
--
-- DEPLOY ORDER: either way round is safe. The route treats a missing table
-- as "no duplicate check" (as before this migration), so old code ignores
-- the table and new code works without it until it is applied.
-- ============================================================

CREATE TABLE IF NOT EXISTS job_status_requests (
  id          UUID PRIMARY KEY,                       -- the client's Idempotency-Key
  job_id      UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_status_requests_job_id ON job_status_requests (job_id);

ALTER TABLE job_status_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON job_status_requests FROM anon, authenticated;
