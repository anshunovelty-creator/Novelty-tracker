-- ============================================================
-- Permission: job_separation_total_view — who sees the "Total order
-- value" sum on Job Separation. It used to ride on job_separation_edit;
-- seed it for every department that holds that today so nobody loses
-- the total, then Admin toggles it per department in Settings →
-- Departments. Admin has every feature implicitly as super-admin.
-- ============================================================
INSERT INTO department_feature_permissions (department_id, feature_key)
SELECT department_id, 'job_separation_total_view'
FROM department_feature_permissions
WHERE feature_key = 'job_separation_edit'
ON CONFLICT DO NOTHING;
