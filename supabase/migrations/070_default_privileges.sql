-- ============================================================
-- 070_default_privileges.sql
-- Stop new objects in public from starting out anon-writable.
--
-- Supabase's default privileges grant anon full rights (arwdDxtm) on every
-- new table/view in public, and EXECUTE on every new function. That's how
-- the client_* views ended up anon-writable (fixed in 066/067): a new
-- SECURITY DEFINER view or function would reopen the same hole silently.
--
-- anon keeps default SELECT on new tables — RLS still decides what it
-- sees, and nothing in the app relies on anon writes (every write goes
-- through an authenticated session or the service-role client). New
-- functions no longer get EXECUTE for anon/PUBLIC by default; grant it
-- explicitly on the rare function the public portal must call.
--
-- Also: log_shade_card_status() and trim_dispatch_notification_history()
-- are trigger functions. Triggers fire regardless of EXECUTE, so signed-in
-- users don't need it either (066 already took it from anon).
-- ============================================================

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, PUBLIC;

REVOKE EXECUTE ON FUNCTION public.log_shade_card_status()              FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.trim_dispatch_notification_history() FROM authenticated;
