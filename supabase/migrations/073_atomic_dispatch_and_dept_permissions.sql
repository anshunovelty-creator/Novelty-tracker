-- ============================================================
-- 073_atomic_dispatch_and_dept_permissions.sql
-- Three gaps from the ACID review (2026-10-07), closed in the database:
--
-- 1. jobs.dispatched_qty is a running total. Every writer used to read it,
--    add in the app, and write the sum back — two dispatches at the same
--    moment each read the old total and one of them vanished, and both
--    passed the "not more than ordered" check. add_job_dispatched does the
--    add and the check in one statement, under the row lock UPDATE takes.
--    (The /status route, which writes many fields at once, instead refuses
--    a save when the job changed since it was read — see its route file.)
--
-- 2. Nothing in the database stopped dispatched_qty going negative or past
--    the order. Now it can't. Verified 2026-10-07: every existing job
--    already satisfies this, so the constraint validates on apply.
--
-- 3. Saving a department deleted its permission rows and then inserted the
--    new set as separate requests, unchecked. A failure in between left the
--    department with no permissions — its people locked out of everything.
--    save_department does the row update and all three replaces as one
--    transaction: all of it lands, or none of it.
--
-- Server-only: both functions are revoked from the browser roles and run
-- through the service-role API routes.
-- ============================================================

-- ── 2. The rule ─────────────────────────────────────────────
ALTER TABLE jobs
  ADD CONSTRAINT jobs_dispatched_qty_in_range
  CHECK (dispatched_qty >= 0 AND (label_qty IS NULL OR dispatched_qty <= label_qty));

-- ── 1. Add to the running total, atomically ─────────────────
-- Returns the job's new totals. Raises 'OVER_DISPATCH' when the qty would
-- take the job past its order; 'JOB_NOT_FOUND' when there is no such job.
CREATE OR REPLACE FUNCTION add_job_dispatched(p_job_id UUID, p_qty INTEGER)
RETURNS TABLE (dispatched_qty INTEGER, total_qty_dispatched INTEGER, label_qty INTEGER)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'Dispatch quantity must be more than zero';
  END IF;

  RETURN QUERY
  UPDATE jobs j
     SET dispatched_qty       = COALESCE(j.dispatched_qty, 0) + p_qty,
         total_qty_dispatched = COALESCE(j.total_qty_dispatched, 0) + p_qty
   WHERE j.id = p_job_id
     AND (j.label_qty IS NULL OR COALESCE(j.dispatched_qty, 0) + p_qty <= j.label_qty)
  RETURNING j.dispatched_qty, j.total_qty_dispatched, j.label_qty;

  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM jobs WHERE id = p_job_id) THEN
      RAISE EXCEPTION 'OVER_DISPATCH';
    END IF;
    RAISE EXCEPTION 'JOB_NOT_FOUND';
  END IF;
END;
$$;

-- ── 3. Save a department in one transaction ─────────────────
-- p_update: only the keys present are changed (display_name,
-- client_facing_name, printing_method_scope, all_stages).
-- p_features / p_stages / p_run_stages: NULL leaves that set untouched;
-- an array (even empty) replaces it.
CREATE OR REPLACE FUNCTION save_department(
  p_department_id UUID,
  p_update        JSONB,
  p_features      TEXT[],
  p_stages        TEXT[],
  p_run_stages    TEXT[]
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE departments SET
    display_name          = CASE WHEN p_update ? 'display_name'          THEN p_update->>'display_name'          ELSE display_name END,
    client_facing_name    = CASE WHEN p_update ? 'client_facing_name'    THEN p_update->>'client_facing_name'    ELSE client_facing_name END,
    printing_method_scope = CASE WHEN p_update ? 'printing_method_scope' THEN p_update->>'printing_method_scope' ELSE printing_method_scope END,
    all_stages            = CASE WHEN p_update ? 'all_stages'            THEN (p_update->>'all_stages')::BOOLEAN ELSE all_stages END
  WHERE id = p_department_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DEPARTMENT_NOT_FOUND';
  END IF;

  IF p_features IS NOT NULL THEN
    DELETE FROM department_feature_permissions WHERE department_id = p_department_id;
    INSERT INTO department_feature_permissions (department_id, feature_key)
    SELECT DISTINCT p_department_id, f FROM unnest(p_features) AS f WHERE f IS NOT NULL AND f <> '';
  END IF;

  IF p_stages IS NOT NULL THEN
    DELETE FROM department_stage_permissions WHERE department_id = p_department_id;
    INSERT INTO department_stage_permissions (department_id, stage)
    SELECT DISTINCT p_department_id, s FROM unnest(p_stages) AS s WHERE s IS NOT NULL AND s <> '';
  END IF;

  IF p_run_stages IS NOT NULL THEN
    DELETE FROM department_run_stage_permissions WHERE department_id = p_department_id;
    INSERT INTO department_run_stage_permissions (department_id, run_stage)
    SELECT DISTINCT p_department_id, r FROM unnest(p_run_stages) AS r WHERE r IS NOT NULL AND r <> '';
  END IF;
END;
$$;

-- Functions are executable by PUBLIC by default — these change dispatch
-- totals and access rights, so only the server may call them.
REVOKE ALL ON FUNCTION add_job_dispatched(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION save_department(UUID, JSONB, TEXT[], TEXT[], TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION add_job_dispatched(UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION save_department(UUID, JSONB, TEXT[], TEXT[], TEXT[]) TO service_role;
