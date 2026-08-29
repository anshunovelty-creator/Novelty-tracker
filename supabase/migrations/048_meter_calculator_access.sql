-- ============================================================
-- NOVELTY LABELS JOB TRACKING SYSTEM
-- Migration 048: meter_calculator_access table
-- ============================================================
-- Grants the Prepress meter calculator (launched from Job Separation) to
-- specific individual logins, not a whole department — an admin picks
-- named people from Control Center the same way team logins are managed.
-- Keyed to a real auth user (mirrors /api/team's "Auth is the source of
-- truth" model) rather than the department_feature_permissions system,
-- which only grants at department granularity.
-- ============================================================

CREATE TABLE meter_calculator_access (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE meter_calculator_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admin can read meter calculator access"
  ON meter_calculator_access FOR SELECT
  TO authenticated
  USING (dept_is_super_admin());

CREATE POLICY "Super admin can grant meter calculator access"
  ON meter_calculator_access FOR INSERT
  TO authenticated
  WITH CHECK (dept_is_super_admin());

CREATE POLICY "Super admin can revoke meter calculator access"
  ON meter_calculator_access FOR DELETE
  TO authenticated
  USING (dept_is_super_admin());
