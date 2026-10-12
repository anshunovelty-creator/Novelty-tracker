-- ============================================================
-- Permission: bom_rates_view — who sees what material costs: the ₹/m²
-- rates on BOM → Materials, and every number made from them (Costing's
-- rate, expense and difference, a request's expense, paper stock value).
-- Seeded to nobody: Admin has it implicitly as super-admin, and bom_decide
-- (who sets the rates) implies it in canDeptSeeMaterialRates. Toggled per
-- department in Settings → Departments.
--
-- The API strips rates for everyone else; this makes the database agree,
-- so a logged-in user can't read them straight from Supabase either.
-- Logins keep every other column; the routes read rates through the
-- service-role client after their own permission check.
--
-- Apply AFTER the app code that reads rates via the admin client is live —
-- the old code selects these columns with the user's session and would
-- fail on them.
-- ============================================================

REVOKE SELECT ON bom_materials FROM anon, authenticated;
GRANT SELECT (id, name, name_key, specification, created_by, created_at, updated_at, is_active, updated_by)
  ON bom_materials TO authenticated;

REVOKE SELECT ON bom_material_requests FROM anon, authenticated;
GRANT SELECT (id, ref, job_separation_id, material_id, material_name, material_width_mm, running_meter,
              order_value, message, status, decision_note, decided_at, decided_by,
              requested_by_department, requested_by, created_at, updated_at, received_at, order_id)
  ON bom_material_requests TO authenticated;
