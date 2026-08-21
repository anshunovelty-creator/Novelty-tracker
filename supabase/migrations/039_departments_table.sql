-- 039_departments_table.sql
-- ============================================================
-- Phase 1 of the configurable-departments redesign (see plan).
-- Purely additive: introduces `departments` + three permission tables,
-- seeded to reproduce today's hardcoded arrays (departments.ts,
-- runStages.ts, machineBoard.ts) exactly. No RLS policy or application
-- code reads from these tables yet — this migration changes nothing
-- about current behavior.
-- ============================================================

CREATE TABLE departments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key                   TEXT UNIQUE NOT NULL,
  display_name          TEXT NOT NULL,
  client_facing_name    TEXT,
  is_protected          BOOLEAN NOT NULL DEFAULT FALSE,
  is_super_admin        BOOLEAN NOT NULL DEFAULT FALSE,
  is_read_only          BOOLEAN NOT NULL DEFAULT FALSE,
  all_stages            BOOLEAN NOT NULL DEFAULT FALSE,
  printing_method_scope TEXT CHECK (printing_method_scope IN ('Offset', 'Flexo')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE department_feature_permissions (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  feature_key   TEXT NOT NULL,
  PRIMARY KEY (department_id, feature_key)
);

CREATE TABLE department_stage_permissions (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  stage         TEXT NOT NULL,
  PRIMARY KEY (department_id, stage)
);

CREATE TABLE department_run_stage_permissions (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  run_stage     TEXT NOT NULL,
  PRIMARY KEY (department_id, run_stage)
);

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE department_feature_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE department_stage_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE department_run_stage_permissions ENABLE ROW LEVEL SECURITY;

-- Every authenticated user needs to read these (every request resolves its
-- own department's permissions); writes are added in the phase-4 migration
-- once dept_is_super_admin() exists, gated on it.
CREATE POLICY "Authenticated users can read departments"
  ON departments FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Authenticated users can read feature permissions"
  ON department_feature_permissions FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Authenticated users can read stage permissions"
  ON department_stage_permissions FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Authenticated users can read run-stage permissions"
  ON department_run_stage_permissions FOR SELECT TO authenticated USING (TRUE);

-- ============================================================
-- Seed: departments that exist today, with flags reproducing
-- DEPARTMENTS / DEPT_ALLOWED_STAGES / DEPT_DISPLAY_NAME exactly.
-- Deliberately excludes Unit1Admin per explicit instruction — it will be
-- created later through the new permissions UI once that's built, rather
-- than pre-seeded here. Until then, any live user account still assigned
-- department 'Unit1Admin' in Supabase Auth will lose access once the app
-- layer cuts over to reading department data from this table (Phase 3) —
-- recreate the department here before that phase ships if one exists.
-- ============================================================
INSERT INTO departments (key, display_name, client_facing_name, is_protected, is_super_admin, is_read_only, all_stages, printing_method_scope) VALUES
  ('Prepress',   'Prepress Team',    NULL,                    FALSE, FALSE, FALSE, FALSE, NULL),
  ('QC',         'QC Team',          NULL,                    FALSE, FALSE, FALSE, FALSE, NULL),
  ('Production', 'Production Team',  NULL,                    FALSE, FALSE, FALSE, FALSE, NULL),
  ('Postpress',  'Postpress Team',   NULL,                    FALSE, FALSE, FALSE, FALSE, NULL),
  ('Dispatch',   'Dispatch Team',    NULL,                    FALSE, FALSE, FALSE, FALSE, NULL),
  ('Admin',      'Admin',            'Novelty Labels Team',   TRUE,  TRUE,  FALSE, TRUE,  NULL),
  ('Viewer',     'Viewer (read-only)', NULL,                  TRUE,  FALSE, TRUE,  FALSE, NULL);

-- ============================================================
-- Seed: department_feature_permissions
-- Mirrors PRINTING_EDIT_DEPTS, JOB_DETAIL_EDIT_DEPTS, STOCK_EDIT_DEPTS,
-- DISPATCH_NOTIFICATION_DEPTS, DIES_PLATES_EDIT_DEPTS,
-- JOB_SEPARATION_EDIT_DEPTS, BOM_DEPTS, plus the ad-hoc literal
-- Admin(+X)-only checks folded in as named features (party_contacts_manage,
-- register_manage, bom_decide, team_manage, export_data, delivery_date_edit,
-- slitting_confirm, print_run_manage, machine_board_manage,
-- po_closed_override). Admin needs no rows here — is_super_admin grants
-- every feature_key implicitly.
-- ============================================================
INSERT INTO department_feature_permissions (department_id, feature_key)
SELECT id, feature_key FROM departments, (VALUES
  ('Prepress',   'printing_edit'),
  ('Production', 'printing_edit'),
  ('Prepress',   'job_detail_edit'),
  ('Dispatch',   'stock_edit'),
  ('Dispatch',   'dispatch_notifications'),
  ('Prepress',   'dies_plates_edit'),
  ('Prepress',   'job_separation_edit'),
  ('Production', 'bom_use'),
  ('Dispatch',   'delivery_date_edit'),
  ('Postpress',  'slitting_confirm'),
  ('Production', 'print_run_manage'),
  ('Production', 'machine_board_manage')
) AS grants(dept_key, feature_key)
WHERE departments.key = grants.dept_key;

-- ============================================================
-- Seed: department_stage_permissions — mirrors DEPT_ALLOWED_STAGES.
-- Admin/Unit1Admin use all_stages=TRUE instead (set above); Viewer gets
-- no rows (matches DEPT_ALLOWED_STAGES.Viewer = []).
-- ============================================================
INSERT INTO department_stage_permissions (department_id, stage)
SELECT id, stage FROM departments, (VALUES
  ('Prepress',   'PO Received'),
  ('Prepress',   'Artwork Pending'),
  ('Prepress',   'Plate Status'),
  ('Prepress',   'Job Card Done'),
  ('QC',         'Sample Printing'),
  ('QC',         'Shade Card Sent'),
  ('QC',         'Shade Card Approved'),
  ('QC',         'Quality Check'),
  ('Production', 'In Printing'),
  ('Production', 'On Hold'),
  ('Postpress',  'Slitting'),
  ('Postpress',  'On Hold'),
  ('Dispatch',   'Packing'),
  ('Dispatch',   'Ready to Dispatch'),
  ('Dispatch',   'Partial Dispatch'),
  ('Dispatch',   'Dispatched')
) AS grants(dept_key, stage)
WHERE departments.key = grants.dept_key;

-- ============================================================
-- Seed: department_run_stage_permissions — mirrors RUN_STAGE_DEPTS.
-- Admin gets every run stage implicitly via is_super_admin.
-- ============================================================
INSERT INTO department_run_stage_permissions (department_id, run_stage)
SELECT id, run_stage FROM departments, (VALUES
  ('Production', 'Printing'),
  ('Postpress',  'Slitting'),
  ('QC',         'QC'),
  ('Dispatch',   'Packing'),
  ('Dispatch',   'Ready to Dispatch'),
  ('Dispatch',   'Dispatched')
) AS grants(dept_key, run_stage)
WHERE departments.key = grants.dept_key;

-- ============================================================
-- job_status_logs.changed_by_dept: was a fixed department-name CHECK
-- (migration 015). Loosen so new departments can write status logs
-- without a schema migration each time.
-- ============================================================
ALTER TABLE job_status_logs
  DROP CONSTRAINT IF EXISTS job_status_logs_changed_by_dept_check;

ALTER TABLE job_status_logs
  ADD CONSTRAINT job_status_logs_changed_by_dept_check
  CHECK (changed_by_dept IS NOT NULL AND changed_by_dept <> '');

-- ============================================================
-- client_status_log_view: previously hardcoded
-- `changed_by_dept = 'Admin' THEN 'Novelty Labels Team' ELSE dept || ' Team'`.
-- Now reads client-facing name from `departments`, so a newly created
-- department shows up correctly on the client portal without a code
-- change. Falls back to the old "<dept> Team" shape if a status log
-- references a department key that's since been deleted.
-- ============================================================
CREATE OR REPLACE VIEW client_status_log_view AS
SELECT
  jsl.id,
  jsl.job_id,
  jsl.status,
  COALESCE(d.client_facing_name, d.display_name, jsl.changed_by_dept || ' Team') AS department_display,
  jsl.changed_at,
  jsl.remark,
  jsl.qty_dispatched
FROM job_status_logs jsl
LEFT JOIN departments d ON d.key = jsl.changed_by_dept;

ALTER VIEW client_status_log_view OWNER TO postgres;
GRANT SELECT ON client_status_log_view TO anon;
