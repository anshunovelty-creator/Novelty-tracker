-- ============================================================
-- NOVELTY LABELS JOB TRACKING SYSTEM
-- Migration 050: Meter Calculator access moves to department_feature_permissions
-- ============================================================
-- Reverses 048_meter_calculator_access.sql — per-person grants turned out
-- to be the wrong shape; every other feature in the app is granted per
-- department (see 039_departments_table.sql), and the team wants this one
-- to follow the same model instead of a separate per-login checklist.
--
-- Seeds Prepress with the new 'meter_calculator_use' feature key, since
-- it already owns Job Separation (job_separation_edit) and dies/plates —
-- the same place the calculator is launched from.
-- ============================================================

DROP TABLE IF EXISTS meter_calculator_access;

INSERT INTO department_feature_permissions (department_id, feature_key)
SELECT id, 'meter_calculator_use' FROM departments WHERE key = 'Prepress'
ON CONFLICT (department_id, feature_key) DO NOTHING;
