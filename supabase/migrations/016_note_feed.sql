-- ============================================================
-- 016_note_feed.sql
-- Global internal-note feed ("Notes" box, bottom-right of admin).
--
-- Internal notes already live in stage_comments and are already readable
-- by every authenticated user (see the SELECT policy in 001). What was
-- missing is (a) attribution to a person, not just a department, and
-- (b) an index that makes a newest-first cross-job query cheap.
--
-- Nothing here widens access: no policy is added or changed.
-- ============================================================

-- ── Attribution ───────────────────────────────────────────────
-- created_by holds the department name ('Prepress', 'Production', …).
-- The feed shows who wrote it, so record the account too.
-- Nullable on purpose: notes written before this migration keep
-- department-only attribution and the UI falls back to that.
ALTER TABLE stage_comments
  ADD COLUMN IF NOT EXISTS created_by_email TEXT;

COMMENT ON COLUMN stage_comments.created_by_email IS
  'Email of the staff account that wrote the note. NULL for notes predating migration 016 — UI falls back to created_by (department).';


-- ── Feed index ────────────────────────────────────────────────
-- The feed query is "newest N notes across all jobs", optionally
-- "newer than <timestamp>" for the unread count. The existing indexes
-- are both job-scoped (idx_sc_job_id, idx_sc_stage) and cannot serve
-- an unfiltered ORDER BY created_at DESC without a full scan + sort.
CREATE INDEX IF NOT EXISTS idx_sc_created_at
  ON stage_comments (created_at DESC);
