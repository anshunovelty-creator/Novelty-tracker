-- ============================================================
-- 076_department_in_app_metadata.sql
-- Department and @username move from user_metadata to app_metadata.
--
-- Why: user_metadata is writable by the signed-in user themself —
-- supabase.auth.updateUser({ data: { department: 'admin' } }) from any
-- browser console. The app and ~37 RLS policies (via current_dept(), used by
-- dept_has_permission and dept_is_super_admin) trusted it, so any staff
-- member could make themselves Admin, or rename themselves to impersonate a
-- colleague in @mentions. app_metadata can only be written with the service
-- role, so it is safe to trust. (Security review 2026-10-06/07.)
--
-- 1. Copy each login's department and username into raw_app_meta_data.
--    Only fills what's missing, so re-running it is harmless — run it again
--    right after deploying if anyone was added in between.
-- 2. current_dept() reads app_metadata from the JWT. A token issued before
--    step 1 doesn't carry it (tokens refresh hourly), so for that case only
--    it reads the same app_metadata from auth.users — the server's copy,
--    never the token's user_metadata.
--
-- The old user_metadata values are left in place, unread. The app code that
-- reads app_metadata ships alongside (src/lib/supabase/claims.ts).
-- ============================================================

UPDATE auth.users
SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
  || jsonb_strip_nulls(jsonb_build_object(
       'department', CASE WHEN raw_app_meta_data ? 'department' THEN NULL ELSE raw_user_meta_data ->> 'department' END,
       'username',   CASE WHEN raw_app_meta_data ? 'username'   THEN NULL ELSE raw_user_meta_data ->> 'username'   END
     ))
WHERE (NOT (COALESCE(raw_app_meta_data, '{}'::jsonb) ? 'department') AND raw_user_meta_data ? 'department')
   OR (NOT (COALESCE(raw_app_meta_data, '{}'::jsonb) ? 'username')   AND raw_user_meta_data ? 'username');

CREATE OR REPLACE FUNCTION public.current_dept()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(
    auth.jwt() -> 'app_metadata' ->> 'department',
    (SELECT u.raw_app_meta_data ->> 'department' FROM auth.users u WHERE u.id = auth.uid())
  )::TEXT;
$$;
