-- ============================================================
-- 071_label_stock_view_permission.sql
-- Label stock gets two department features instead of one:
--   stock_view — see Label Stock (the tab, the list, and the "already in
--                stock" hint when a job is entered)
--   stock_edit — manage it: add, edit, dispatch out, delete (unchanged
--                key; implies stock_view)
-- Admin (is_super_admin) holds both implicitly.
--
-- Until now every department could read stock, so stock_view is granted
-- to every existing department — nothing changes for anyone on deploy.
-- Admin then takes it away per department in /admin/departments.
-- New departments start without it.
--
-- Also: Job Separation gets the same letters-and-digits PO / PM key that
-- jobs got in 069, so a manual stock entry can find "POMSND2627-0557"
-- when someone types "pomsnd26270557".
--
-- DEPLOY ORDER: apply BEFORE deploying the code that searches po_norm on
-- job_separations. The grants make the RLS change a no-op for every
-- existing department, so it is safe with the old code too.
-- ============================================================

INSERT INTO department_feature_permissions (department_id, feature_key)
SELECT id, 'stock_view'
FROM departments
WHERE NOT is_super_admin
ON CONFLICT DO NOTHING;

-- Reads follow the feature; writes stay on the service-role API path.
DROP POLICY IF EXISTS "label_stock_select_authenticated" ON label_stock;
CREATE POLICY "label_stock_select_permitted"
  ON label_stock FOR SELECT
  TO authenticated
  USING (dept_has_permission('stock_view') OR dept_has_permission('stock_edit'));

ALTER TABLE public.job_separations
  ADD COLUMN IF NOT EXISTS po_norm text
    GENERATED ALWAYS AS (lower(regexp_replace(coalesce(po_no, ''), '[^A-Za-z0-9]', '', 'g'))) STORED,
  ADD COLUMN IF NOT EXISTS pm_norm text
    GENERATED ALWAYS AS (lower(regexp_replace(coalesce(pm_code, ''), '[^A-Za-z0-9]', '', 'g'))) STORED;

CREATE INDEX IF NOT EXISTS idx_job_separations_po_norm ON public.job_separations (po_norm);

COMMENT ON COLUMN public.job_separations.po_norm IS
  'po_no lowercased, letters and digits only. Manual label-stock job lookup (071).';
COMMENT ON COLUMN public.job_separations.pm_norm IS
  'pm_code lowercased, letters and digits only. Manual label-stock job lookup (071).';
