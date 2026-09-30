-- ============================================================
-- Client portal (/track) anon lockdown.
--
-- client_job_view and client_status_log_view were plain (security
-- definer) views owned by postgres, so they bypassed RLS on jobs /
-- job_status_logs, and anon held SELECT on them with no row filter —
-- plus INSERT/UPDATE/DELETE, which on a simple auto-updatable view
-- reach the underlying table. With only the public anon key anyone
-- could GET /rest/v1/client_job_view?select=* and dump every job
-- (party, job_name, notes, remarks). The PO + Company Name gate only
-- lived in app code. print_runs likewise had an anon USING (TRUE)
-- policy with a table-wide grant that included the internal `notes`.
--
-- /track now reads everything through the service-role client on the
-- server (src/app/track/[po]/page.tsx), so the anon role needs none of
-- this. Nothing authenticated reads the two views either (the admin
-- panel reads the base tables), so authenticated loses them too; only
-- service_role (and the owner) keep access.
--
-- DEPLOY ORDER: ship the /track code change first. Applying this
-- before that deploy makes every /track lookup return "No Matching Job
-- Found".
-- ============================================================

-- Client views: no direct API access; RLS of the caller applies.
REVOKE ALL ON public.client_job_view        FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.client_status_log_view FROM anon, authenticated, PUBLIC;

ALTER VIEW IF EXISTS public.client_job_view        SET (security_invoker = true);
ALTER VIEW IF EXISTS public.client_status_log_view SET (security_invoker = true);

GRANT SELECT ON public.client_job_view        TO service_role;
GRANT SELECT ON public.client_status_log_view TO service_role;

-- print_runs: drop the open anon read (from 005_print_runs.sql) and the
-- table-level anon grant. Authenticated policies are untouched.
DROP POLICY IF EXISTS "Anonymous can read print runs" ON public.print_runs;
REVOKE ALL ON public.print_runs FROM anon;

-- Leftover anon grants from 004_jobs_core.sql's portal section. RLS has
-- no anon policy on either table, so these already returned nothing;
-- /track reads both through the service-role client now.
REVOKE ALL ON public.dispatch_schedules   FROM anon;
REVOKE ALL ON public.job_stage_timestamps FROM anon;
