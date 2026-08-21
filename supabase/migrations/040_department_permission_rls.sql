-- 040_department_permission_rls.sql
-- ============================================================
-- Phase 2 of the configurable-departments redesign (see plan).
-- Adds two SQL helper functions and rewrites every RLS policy that
-- currently hardcodes a department literal (found by inventorying all
-- migrations: current_dept() = 'Admin' / IN ('Dispatch','Admin') / the
-- inline-JWT '= Admin' / IN ('Admin','Production') on register_*/bom_*
-- that bypass current_dept() entirely) to read from the new
-- departments / department_feature_permissions tables instead.
--
-- dept_is_super_admin() is used only for the handful of bare "only the
-- one true super-admin" gates that were never a named, independently
-- grantable feature (hard-deleting jobs/timestamps/print runs, and the
-- dispatch-schedule hard delete). Everything that maps to one of the
-- named feature_keys seeded/reserved in migration 039 uses
-- dept_has_permission(), so it stays independently grantable to any
-- future department through the admin UI (Phase 4) — including
-- 'party_contacts_manage', 'register_manage', 'notification_recipients_manage',
-- none of which had any department granted them in the 039 seed (Admin
-- gets them implicitly via is_super_admin), exactly matching today's
-- Admin-only behavior until someone chooses to grant them elsewhere.
-- ============================================================

CREATE OR REPLACE FUNCTION dept_is_super_admin() RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT is_super_admin FROM departments WHERE key = current_dept()),
    FALSE
  );
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION dept_has_permission(p_feature_key TEXT) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM departments d
    WHERE d.key = current_dept()
      AND (
        d.is_super_admin
        OR EXISTS (
          SELECT 1 FROM department_feature_permissions p
          WHERE p.department_id = d.id AND p.feature_key = p_feature_key
        )
      )
  );
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- ============================================================
-- jobs / job_stage_timestamps / print_runs — bare super-admin-only
-- hard-delete gates. No named feature_key exists for these today (no
-- canDeptXxx helper ever covered them either — RLS-only gates).
-- ============================================================
DROP POLICY IF EXISTS "Admin can delete jobs" ON jobs;
CREATE POLICY "Admin can delete jobs"
  ON jobs FOR DELETE TO authenticated
  USING (dept_is_super_admin());

DROP POLICY IF EXISTS "Admin can delete stage timestamps" ON job_stage_timestamps;
CREATE POLICY "Admin can delete stage timestamps"
  ON job_stage_timestamps FOR DELETE TO authenticated
  USING (dept_is_super_admin());

DROP POLICY IF EXISTS "Admin can delete print runs" ON print_runs;
CREATE POLICY "Admin can delete print runs"
  ON print_runs FOR DELETE TO authenticated
  USING (dept_is_super_admin());

-- ============================================================
-- party_contacts — writes map to the named 'party_contacts_manage'
-- feature (Admin-only today via is_super_admin; independently
-- grantable later).
-- ============================================================
DROP POLICY IF EXISTS "Admin can insert party contacts" ON party_contacts;
CREATE POLICY "Admin can insert party contacts"
  ON party_contacts FOR INSERT TO authenticated
  WITH CHECK (dept_has_permission('party_contacts_manage'));

DROP POLICY IF EXISTS "Admin can update party contacts" ON party_contacts;
CREATE POLICY "Admin can update party contacts"
  ON party_contacts FOR UPDATE TO authenticated
  USING (dept_has_permission('party_contacts_manage'));

DROP POLICY IF EXISTS "Admin can delete party contacts" ON party_contacts;
CREATE POLICY "Admin can delete party contacts"
  ON party_contacts FOR DELETE TO authenticated
  USING (dept_has_permission('party_contacts_manage'));

-- ============================================================
-- dispatch_schedules — UPDATE maps to 'delivery_date_edit' (matches
-- today's Dispatch+Admin exactly, seeded in 039). DELETE stays a bare
-- super-admin-only gate, same reasoning as jobs/print_runs above.
-- ============================================================
DROP POLICY IF EXISTS "Dispatch and Admin can update schedules" ON dispatch_schedules;
CREATE POLICY "Dispatch and Admin can update schedules"
  ON dispatch_schedules FOR UPDATE TO authenticated
  USING (dept_has_permission('delivery_date_edit'));

DROP POLICY IF EXISTS "Admin can delete dispatch schedules" ON dispatch_schedules;
CREATE POLICY "Admin can delete dispatch schedules"
  ON dispatch_schedules FOR DELETE TO authenticated
  USING (dept_is_super_admin());

-- ============================================================
-- pending_dispatch_notifications — maps to 'dispatch_notifications'
-- (matches today's Dispatch+Admin, seeded in 039).
-- ============================================================
DROP POLICY IF EXISTS "Dispatch/Admin can read pending dispatch notifications" ON pending_dispatch_notifications;
CREATE POLICY "Dispatch/Admin can read pending dispatch notifications"
  ON pending_dispatch_notifications FOR SELECT TO authenticated
  USING (dept_has_permission('dispatch_notifications'));

DROP POLICY IF EXISTS "Dispatch/Admin can update pending dispatch notifications" ON pending_dispatch_notifications;
CREATE POLICY "Dispatch/Admin can update pending dispatch notifications"
  ON pending_dispatch_notifications FOR UPDATE TO authenticated
  USING (dept_has_permission('dispatch_notifications'));

-- ============================================================
-- internal_notification_recipients — maps to the named
-- 'notification_recipients_manage' feature (Admin-only today via
-- is_super_admin — no rows were seeded for it in 039, same shape as
-- party_contacts_manage/register_manage; independently grantable later).
-- ============================================================
DROP POLICY IF EXISTS "Admin can read internal notification recipients" ON internal_notification_recipients;
CREATE POLICY "Admin can read internal notification recipients"
  ON internal_notification_recipients FOR SELECT TO authenticated
  USING (dept_has_permission('notification_recipients_manage'));

DROP POLICY IF EXISTS "Admin can insert internal notification recipients" ON internal_notification_recipients;
CREATE POLICY "Admin can insert internal notification recipients"
  ON internal_notification_recipients FOR INSERT TO authenticated
  WITH CHECK (dept_has_permission('notification_recipients_manage'));

DROP POLICY IF EXISTS "Admin can delete internal notification recipients" ON internal_notification_recipients;
CREATE POLICY "Admin can delete internal notification recipients"
  ON internal_notification_recipients FOR DELETE TO authenticated
  USING (dept_has_permission('notification_recipients_manage'));

-- ============================================================
-- register_accounts / register_deals / register_activities — previously
-- inline `(auth.jwt() -> 'user_metadata' ->> 'department') = 'Admin'`,
-- bypassing current_dept() entirely. Now map to 'register_manage'
-- (matches today's Admin-only, seeded in 039).
-- ============================================================
DROP POLICY IF EXISTS "register_accounts_select_admin" ON register_accounts;
CREATE POLICY "register_accounts_select_admin"
  ON register_accounts FOR SELECT TO authenticated
  USING (dept_has_permission('register_manage'));

DROP POLICY IF EXISTS "register_deals_select_admin" ON register_deals;
CREATE POLICY "register_deals_select_admin"
  ON register_deals FOR SELECT TO authenticated
  USING (dept_has_permission('register_manage'));

DROP POLICY IF EXISTS "register_activities_select_admin" ON register_activities;
CREATE POLICY "register_activities_select_admin"
  ON register_activities FOR SELECT TO authenticated
  USING (dept_has_permission('register_manage'));

-- ============================================================
-- bom_requests / bom_request_items / bom_materials — previously inline
-- `(auth.jwt() -> 'user_metadata' ->> 'department') IN ('Admin', 'Production')`.
-- Now map to 'bom_use' (matches today's Admin+Production, seeded in 039;
-- Admin via is_super_admin, Production via the seeded row).
-- ============================================================
DROP POLICY IF EXISTS "bom_requests_select_prod_admin" ON bom_requests;
CREATE POLICY "bom_requests_select_prod_admin"
  ON bom_requests FOR SELECT TO authenticated
  USING (dept_has_permission('bom_use'));

DROP POLICY IF EXISTS "bom_request_items_select_prod_admin" ON bom_request_items;
CREATE POLICY "bom_request_items_select_prod_admin"
  ON bom_request_items FOR SELECT TO authenticated
  USING (dept_has_permission('bom_use'));

DROP POLICY IF EXISTS "bom_materials_select_prod_admin" ON bom_materials;
CREATE POLICY "bom_materials_select_prod_admin"
  ON bom_materials FOR SELECT TO authenticated
  USING (dept_has_permission('bom_use'));

-- ============================================================
-- Write policies for the department tables themselves, now that
-- dept_is_super_admin() exists. Only the super-admin department may
-- create/rename/delete departments or edit their permission grids —
-- this is what the Phase 4 admin UI will write through.
-- ============================================================
CREATE POLICY "Super admin can insert departments"
  ON departments FOR INSERT TO authenticated
  WITH CHECK (dept_is_super_admin());
CREATE POLICY "Super admin can update departments"
  ON departments FOR UPDATE TO authenticated
  USING (dept_is_super_admin());
CREATE POLICY "Super admin can delete departments"
  ON departments FOR DELETE TO authenticated
  USING (dept_is_super_admin() AND NOT is_protected);

CREATE POLICY "Super admin can insert feature permissions"
  ON department_feature_permissions FOR INSERT TO authenticated
  WITH CHECK (dept_is_super_admin());
CREATE POLICY "Super admin can delete feature permissions"
  ON department_feature_permissions FOR DELETE TO authenticated
  USING (dept_is_super_admin());

CREATE POLICY "Super admin can insert stage permissions"
  ON department_stage_permissions FOR INSERT TO authenticated
  WITH CHECK (dept_is_super_admin());
CREATE POLICY "Super admin can delete stage permissions"
  ON department_stage_permissions FOR DELETE TO authenticated
  USING (dept_is_super_admin());

CREATE POLICY "Super admin can insert run-stage permissions"
  ON department_run_stage_permissions FOR INSERT TO authenticated
  WITH CHECK (dept_is_super_admin());
CREATE POLICY "Super admin can delete run-stage permissions"
  ON department_run_stage_permissions FOR DELETE TO authenticated
  USING (dept_is_super_admin());
