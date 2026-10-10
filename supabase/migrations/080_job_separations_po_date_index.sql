-- ============================================================
-- 080_job_separations_po_date_index.sql
-- The Job Separation list (and Bill of Material) scope rows by po_date —
-- "Current month" / "Last 3 months" in src/lib/jobSeparationQuery.ts — but
-- only created_at was indexed. Fine at ~1k rows; this keeps the month view
-- fast as the table grows by ~500 rows a month. Additive, no data change.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_job_separations_po_date
  ON job_separations (po_date DESC);
