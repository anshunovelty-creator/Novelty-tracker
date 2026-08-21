-- 041_split_prepress_todo_permission.sql
-- ============================================================
-- The Prepress-Todo checklist used to be bundled under
-- 'job_separation_edit' — granting Job Separation edit access
-- automatically granted Todo access too, with no way to separate them.
-- Splits it into its own feature_key, 'prepress_todo_manage', so the two
-- can be granted independently going forward.
--
-- Preserves today's default behavior exactly: Prepress already had
-- implicit Todo access via job_separation_edit, so it gets the new key
-- too here. Admin needs no row — is_super_admin already grants every
-- feature_key implicitly.
-- ============================================================

INSERT INTO department_feature_permissions (department_id, feature_key)
SELECT id, 'prepress_todo_manage' FROM departments WHERE key = 'Prepress';
