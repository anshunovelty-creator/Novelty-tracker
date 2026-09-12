-- ============================================================
-- 057_jobs_search_indexes.sql
-- Trigram indexes for the free-text search against `jobs` — the same
-- problem already fixed for job_separations in 025_job_separations_search_indexes.sql,
-- unapplied here until now.
--
-- Two call sites do leading-wildcard `ilike '%term%'` lookups, which a
-- plain btree index (idx_jobs_po_number, idx_jobs_party from
-- 001_initial_schema.sql) cannot serve, forcing a full sequential scan
-- of `jobs` on every search:
--   - GET /api/jobs admin search (src/app/api/jobs/route.ts):
--     job_card_number, po_number, party, job_name
--   - The public /track/[po] portal (src/app/track/[po]/page.tsx), via
--     client_job_view (a plain view over jobs, so base-table indexes
--     apply): po_number, pm_code, party
--
-- Fine at today's job volume; degrades as job history accumulates,
-- independent of concurrent user count. GIN trigram indexes make
-- ILIKE '%term%' as searchable as a btree makes equality.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_jobs_job_card_number_trgm
  ON jobs USING GIN (job_card_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_jobs_po_number_trgm
  ON jobs USING GIN (po_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_jobs_party_trgm
  ON jobs USING GIN (party gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_jobs_job_name_trgm
  ON jobs USING GIN (job_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_jobs_pm_code_trgm
  ON jobs USING GIN (pm_code gin_trgm_ops);
