-- ============================================================
-- NOVELTY LABELS JOB TRACKING SYSTEM
-- Migration 001: Initial Schema
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- ============================================================

-- Enable UUID extension (usually already enabled on Supabase)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ============================================================
-- TABLE: jobs
-- Core job record. One row per PO + PM code combination.
-- ============================================================
CREATE TABLE jobs (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_number             TEXT NOT NULL,
  pm_code               TEXT,
  party                 TEXT NOT NULL,
  job_name              TEXT,
  label_qty             INTEGER,
  po_date               DATE,
  delivery_date         DATE,
  status                TEXT NOT NULL DEFAULT 'PO Received',
  job_type              TEXT NOT NULL DEFAULT 'New'
                          CHECK (job_type IN ('New', 'Repeat', 'Artwork Changed')),
  urgent                BOOLEAN NOT NULL DEFAULT FALSE,
  urgent_priority       INTEGER CHECK (urgent_priority BETWEEN 1 AND 5),
  notes                 TEXT,
  dispatched_qty        INTEGER NOT NULL DEFAULT 0,
  remaining_qty         INTEGER,  -- computed on insert/update; kept in sync via trigger
  halt_remark           TEXT,
  qc_remark             TEXT,
  is_scheduled_release  BOOLEAN NOT NULL DEFAULT FALSE,
  is_closed             BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for the most common lookups
CREATE INDEX idx_jobs_po_number     ON jobs (po_number);
CREATE INDEX idx_jobs_party         ON jobs (party);
CREATE INDEX idx_jobs_status        ON jobs (status);
CREATE INDEX idx_jobs_delivery_date ON jobs (delivery_date);
CREATE INDEX idx_jobs_is_closed     ON jobs (is_closed);
CREATE INDEX idx_jobs_urgent        ON jobs (urgent, urgent_priority);


-- ============================================================
-- TABLE: job_stage_timestamps
-- One row per (job, stage) once that stage is completed.
-- Used for prerequisite enforcement.
-- ============================================================
CREATE TABLE job_stage_timestamps (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id        UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  stage         TEXT NOT NULL,
  completed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, stage)  -- only one completion record per stage per job
);

CREATE INDEX idx_jst_job_id ON job_stage_timestamps (job_id);


-- ============================================================
-- TABLE: job_status_logs
-- Permanent audit log. Never deleted. Every status change ever.
-- ============================================================
CREATE TABLE job_status_logs (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id            UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  status            TEXT NOT NULL,
  changed_by_dept   TEXT NOT NULL
                      CHECK (changed_by_dept IN ('Prepress', 'QC', 'Production', 'Dispatch', 'Admin')),
  changed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  remark            TEXT,         -- halt_remark or qc_remark; NULL otherwise
  qty_dispatched    INTEGER       -- only for Partial Dispatch or Dispatched; NULL otherwise
);

CREATE INDEX idx_jsl_job_id    ON job_status_logs (job_id);
CREATE INDEX idx_jsl_changed_at ON job_status_logs (changed_at DESC);


-- ============================================================
-- TABLE: stage_comments
-- Internal only. Per-stage comment threads. Never shown to clients.
-- ============================================================
CREATE TABLE stage_comments (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id        UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  stage         TEXT NOT NULL,
  comment       TEXT NOT NULL,
  created_by    TEXT NOT NULL,   -- department name
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sc_job_id ON stage_comments (job_id);
CREATE INDEX idx_sc_stage  ON stage_comments (job_id, stage);


-- ============================================================
-- TABLE: dispatch_schedules
-- Only used when jobs.is_scheduled_release = true.
-- One row per planned release. Stays in place even after dispatch.
-- ============================================================
CREATE TABLE dispatch_schedules (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  release_number  INTEGER NOT NULL,
  planned_qty     INTEGER NOT NULL,
  planned_date    DATE NOT NULL,
  actual_qty      INTEGER,      -- NULL until dispatched
  actual_date     TIMESTAMPTZ,  -- NULL until dispatched
  status          TEXT NOT NULL DEFAULT 'Pending'
                    CHECK (status IN ('Pending', 'In Progress', 'Dispatched')),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, release_number)
);

CREATE INDEX idx_ds_job_id ON dispatch_schedules (job_id);
CREATE INDEX idx_ds_planned_date ON dispatch_schedules (planned_date);


-- ============================================================
-- TRIGGER: auto-update jobs.updated_at on every row change
-- ============================================================
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();


-- ============================================================
-- TRIGGER: keep jobs.remaining_qty in sync
-- remaining_qty = label_qty - dispatched_qty
-- Fires on INSERT and UPDATE of dispatched_qty or label_qty
-- ============================================================
CREATE OR REPLACE FUNCTION trigger_sync_remaining_qty()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.label_qty IS NOT NULL THEN
    NEW.remaining_qty = NEW.label_qty - COALESCE(NEW.dispatched_qty, 0);
  ELSE
    NEW.remaining_qty = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sync_remaining_qty
  BEFORE INSERT OR UPDATE OF label_qty, dispatched_qty ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION trigger_sync_remaining_qty();


-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- All reads go through department-based auth.
-- Supabase Auth user metadata will store: { "department": "QC" }
-- ============================================================

ALTER TABLE jobs                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_stage_timestamps ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_status_logs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE stage_comments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_schedules   ENABLE ROW LEVEL SECURITY;


-- Helper function: get the department of the current authenticated user
-- Reads from auth.users.raw_user_meta_data ->> 'department'
CREATE OR REPLACE FUNCTION current_dept()
RETURNS TEXT AS $$
  SELECT (auth.jwt() -> 'user_metadata' ->> 'department')::TEXT;
$$ LANGUAGE SQL STABLE SECURITY DEFINER;


-- ── jobs ──────────────────────────────────────────────────────

-- All authenticated users can read all jobs (for search, context)
CREATE POLICY "Authenticated users can read all jobs"
  ON jobs FOR SELECT
  TO authenticated
  USING (TRUE);

-- All authenticated users can insert jobs (Add Job is open to all depts)
CREATE POLICY "Authenticated users can insert jobs"
  ON jobs FOR INSERT
  TO authenticated
  WITH CHECK (TRUE);

-- Updates: department-scoped for status field; Admin can update anything
-- We enforce stage-level locking in the application layer (not SQL),
-- because it depends on job_type and prerequisite logic that's too
-- complex to encode in pure SQL CHECK constraints.
-- What we CAN enforce here: only authenticated users update.
CREATE POLICY "Authenticated users can update jobs"
  ON jobs FOR UPDATE
  TO authenticated
  USING (TRUE);

-- Delete: Admin only
CREATE POLICY "Admin can delete jobs"
  ON jobs FOR DELETE
  TO authenticated
  USING (current_dept() = 'Admin');


-- ── job_stage_timestamps ──────────────────────────────────────

CREATE POLICY "Authenticated users can read stage timestamps"
  ON job_stage_timestamps FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "Authenticated users can insert stage timestamps"
  ON job_stage_timestamps FOR INSERT
  TO authenticated
  WITH CHECK (TRUE);

-- No updates to stage timestamps — they are append-only records.
-- If a stage is redone, insert a new row (UNIQUE constraint prevents duplicates;
-- application must DELETE then INSERT if re-stamping a stage — Admin only).
CREATE POLICY "Admin can delete stage timestamps"
  ON job_stage_timestamps FOR DELETE
  TO authenticated
  USING (current_dept() = 'Admin');


-- ── job_status_logs ───────────────────────────────────────────

CREATE POLICY "Authenticated users can read status logs"
  ON job_status_logs FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "Authenticated users can insert status logs"
  ON job_status_logs FOR INSERT
  TO authenticated
  WITH CHECK (TRUE);

-- NO update or delete policies on status logs — permanent audit trail.


-- ── stage_comments ────────────────────────────────────────────

CREATE POLICY "Authenticated users can read stage comments"
  ON stage_comments FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "Authenticated users can insert stage comments"
  ON stage_comments FOR INSERT
  TO authenticated
  WITH CHECK (TRUE);

-- Comments are not edited or deleted (append-only like logs).


-- ── dispatch_schedules ────────────────────────────────────────

CREATE POLICY "Authenticated users can read dispatch schedules"
  ON dispatch_schedules FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "Authenticated users can insert dispatch schedules"
  ON dispatch_schedules FOR INSERT
  TO authenticated
  WITH CHECK (TRUE);

-- Dispatch and Admin can update schedule rows (mark as dispatched, update actual)
CREATE POLICY "Dispatch and Admin can update schedules"
  ON dispatch_schedules FOR UPDATE
  TO authenticated
  USING (current_dept() IN ('Dispatch', 'Admin'));

CREATE POLICY "Admin can delete dispatch schedules"
  ON dispatch_schedules FOR DELETE
  TO authenticated
  USING (current_dept() = 'Admin');


-- ============================================================
-- CLIENT PORTAL: Anonymous read access
-- The client tracking portal (track.noveltylabels.com) uses
-- anonymous Supabase key — no login required.
-- Clients can only read jobs and dispatch_schedules.
-- They CANNOT see stage_comments (internal) or job_status_logs directly.
-- A separate Postgres VIEW (below) exposes only client-safe data.
-- ============================================================

-- Public-safe view for client portal — strips internal fields
CREATE OR REPLACE VIEW client_job_view AS
SELECT
  j.id,
  j.po_number,
  j.pm_code,
  j.party,
  j.job_name,
  j.label_qty,
  j.po_date,
  j.delivery_date,
  j.status,
  j.job_type,
  j.urgent,
  j.urgent_priority,
  j.notes,
  j.dispatched_qty,
  j.remaining_qty,
  j.halt_remark,
  j.qc_remark,
  j.is_scheduled_release,
  j.is_closed,
  j.created_at,
  j.updated_at
  -- Deliberately excludes: nothing secret at job level for client
  -- stage_comments exclusion is enforced by NOT selecting from that table
FROM jobs j;

-- Public read on the view (anonymous = client portal)
ALTER VIEW client_job_view OWNER TO postgres;

GRANT SELECT ON client_job_view TO anon;
GRANT SELECT ON dispatch_schedules TO anon;

-- Also need job_stage_timestamps for progress bar calculation on client portal
GRANT SELECT ON job_stage_timestamps TO anon;

-- Client-safe status log view: strips internal dept names, replaces Admin with "Novelty Labels Team"
CREATE OR REPLACE VIEW client_status_log_view AS
SELECT
  jsl.id,
  jsl.job_id,
  jsl.status,
  CASE
    WHEN jsl.changed_by_dept = 'Admin' THEN 'Novelty Labels Team'
    ELSE jsl.changed_by_dept || ' Team'
  END AS department_display,
  jsl.changed_at,
  jsl.remark,       -- halt_remark or qc_remark — visible to client per spec
  jsl.qty_dispatched
FROM job_status_logs jsl;

ALTER VIEW client_status_log_view OWNER TO postgres;
GRANT SELECT ON client_status_log_view TO anon;


-- ============================================================
-- SEED DATA: Department user accounts
-- Create these via Supabase Dashboard → Authentication → Users
-- OR via the Auth Admin API. The SQL below documents what metadata
-- each user needs. You cannot INSERT directly into auth.users.
--
-- After creating each user in the Dashboard, set their
-- "User Metadata" (raw_user_meta_data) to the JSON shown:
--
-- prepress@noveltylabels.com   → { "department": "Prepress",   "display_name": "Prepress Team" }
-- qc@noveltylabels.com         → { "department": "QC",         "display_name": "QC Team" }
-- production@noveltylabels.com → { "department": "Production", "display_name": "Production Team" }
-- dispatch@noveltylabels.com   → { "department": "Dispatch",   "display_name": "Dispatch Team" }
-- admin@noveltylabels.com      → { "department": "Admin",      "display_name": "Admin" }
--
-- Password: set a strong password for each. Store in a password manager.
-- ============================================================


-- ============================================================
-- ANALYTICS HELPER: on_time_dispatch_log
-- Appended to when any job is marked Dispatched.
-- Records whether dispatch was on time (actual <= planned delivery date).
-- Powers the "On-time delivery: X% this month" dashboard card.
-- ============================================================
CREATE TABLE on_time_dispatch_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  dispatched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivery_date   DATE,         -- the delivery_date at time of dispatch
  is_on_time      BOOLEAN,      -- TRUE if dispatched_at::date <= delivery_date
  month_key       TEXT          -- 'YYYY-MM' for easy monthly aggregation
);

CREATE INDEX idx_otdl_month_key ON on_time_dispatch_log (month_key);
CREATE INDEX idx_otdl_job_id    ON on_time_dispatch_log (job_id);

ALTER TABLE on_time_dispatch_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read dispatch log"
  ON on_time_dispatch_log FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "Authenticated users can insert dispatch log"
  ON on_time_dispatch_log FOR INSERT
  TO authenticated
  WITH CHECK (TRUE);


-- ============================================================
-- INDEXES for dashboard summary card queries
-- ============================================================

-- Active jobs count: WHERE is_closed = false
-- (idx_jobs_is_closed already covers this)

-- Jobs on hold count: WHERE status = 'On Hold' AND is_closed = false
CREATE INDEX idx_jobs_status_on_hold ON jobs (status) WHERE status = 'On Hold';

-- Jobs due this week
-- (idx_jobs_delivery_date covers range queries)

-- Jobs dispatched this month
CREATE INDEX idx_jsl_dispatched_this_month
  ON job_status_logs (changed_at)
  WHERE status = 'Dispatched';


-- ============================================================
-- Done. Schema complete.
-- Next: Create the 5 department users in Supabase Dashboard Auth.
-- Then proceed to Next.js project setup.
-- ============================================================
