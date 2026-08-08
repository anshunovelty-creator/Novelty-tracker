-- ============================================================
-- 025_job_separations_search_indexes.sql
-- Trigram indexes for the free-text search in GET /api/job-separations.
-- That search is `ilike '%term%'` — a leading wildcard, which means the
-- existing btree indexes (idx_job_separations_created, the sr_no
-- uniqueness indexes) can't be used to satisfy it. Without a trigram
-- index every such search is a full table scan; fine at a few thousand
-- rows, not fine once "All data" covers years of history. GIN trigram
-- indexes make ILIKE '%term%' as searchable as a btree makes equality —
-- and stay cheap to maintain at this table's write rate (a few hundred
-- rows/month).
--
-- One index per column in JOB_SEPARATION_SEARCH_FIELDS (route.ts) so
-- every field-scoped search benefits, not just the "all fields" default.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_job_separations_sr_no_trgm
  ON job_separations USING GIN (sr_no gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_job_separations_party_trgm
  ON job_separations USING GIN (party gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_job_separations_po_no_trgm
  ON job_separations USING GIN (po_no gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_job_separations_pm_code_trgm
  ON job_separations USING GIN (pm_code gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_job_separations_material_name_trgm
  ON job_separations USING GIN (material_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_job_separations_unit_trgm
  ON job_separations USING GIN (unit gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_job_separations_job_status_trgm
  ON job_separations USING GIN (job_status gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_job_separations_jc_status_trgm
  ON job_separations USING GIN (jc_status gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_job_separations_aw_send_to_trgm
  ON job_separations USING GIN (aw_send_to gin_trgm_ops);
