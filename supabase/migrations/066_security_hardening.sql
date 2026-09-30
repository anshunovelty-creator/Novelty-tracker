-- ============================================================
-- 066_security_hardening.sql
-- Security pass flagged by the Supabase security advisor (2026-09-30).
--
-- Every statement here is guarded or naturally repeatable, so the file
-- is safe to re-run and safe on a database rebuilt from the consolidated
-- 001-017 schema (which never recreated the per-table trigger_touch_*
-- functions or client_print_run_stage_log_view; those only exist on the
-- live database, so they are looked up and skipped when absent).
--
-- 1. function_search_path_mutable: pin search_path on 23 functions to
--    `public, pg_temp`. Every body was read from pg_proc: they reference
--    only public tables/functions (unqualified) or auth.jwt()/auth.uid()
--    (schema-qualified), plus pg_catalog built-ins, which are always
--    searched. None call pg_trgm. Behaviour unchanged.
--
-- 2. anon_security_definer_function_executable: revoke EXECUTE from
--    PUBLIC and anon on six SECURITY DEFINER functions. Checked first:
--      - The only RLS policy that applies to anon is
--        print_runs "Anonymous can read print runs" (USING true). No
--        anon or PUBLIC policy, in any schema, calls these functions.
--        Every policy that does call them is TO authenticated.
--      - /track (src/app/track/[po]/page.tsx) never calls them: it reads
--        client_job_view, client_status_log_view, dispatch_schedules and
--        print_runs with the anon key, and the rest with the service-role
--        client. No .rpc() anywhere in src/ targets these functions.
--      - The client_* views don't reference them.
--      - log_shade_card_status and trim_dispatch_notification_history are
--        trigger functions. Postgres checks EXECUTE on a trigger function
--        only at CREATE TRIGGER time (trigger.c CreateTriggerFiringOn);
--        ExecCallTriggerFunc invokes it through fmgr with no ACL check.
--        So revoking does not stop the triggers from firing for any role.
--    authenticated and service_role keep EXECUTE through their own
--    explicit grants (re-stated below so the file doesn't rely on that).
--
-- 3. security_definer_view:
--    - client_job_view / client_status_log_view: LEFT AS DEFINER VIEWS.
--      /track reads them with the anon key (page.tsx:52-56, 86-90), and
--      anon has no SELECT policy on jobs / job_status_logs, so
--      security_invoker would empty the portal. What we do tighten: the
--      Supabase default grants gave anon and authenticated
--      INSERT/UPDATE/DELETE on these views. client_job_view is a simple
--      single-table view, so Postgres makes it auto-updatable, and because
--      it runs with its owner's (postgres) rights, which skip RLS on jobs,
--      anyone holding the public anon key could insert, update or delete
--      jobs through PostgREST. Nothing in the app writes through
--      these views, so we revoke everything except SELECT.
--    - client_print_run_stage_log_view: nothing in the repo uses it
--      (/track reads print_run_stage_logs via the service-role client,
--      page.tsx:118-124). It is also auto-updatable. Switched to
--      security_invoker and taken away from anon. authenticated keeps
--      SELECT, and the base table's existing "Authenticated users can
--      read print run logs" policy still lets it through.
--
-- 4. rls_enabled_no_policy (company_settings, job_card_counters,
--    job_separation_counters, machine_queue_items, machines): deliberate.
--    RLS with no policies means deny-all for anon/authenticated. The app
--    only touches these through the service-role client (src/lib/
--    branding.ts, src/app/api/settings/branding/**, src/app/api/machines/**,
--    src/lib/api/machine{Display,Analytics}.ts). The counters are written
--    only by the job-card / Sr. No. triggers, which fire on inserts that
--    also go through the service-role client (api/jobs/route.ts,
--    api/job-separations/route.ts). Documented with COMMENTs, no policies
--    added.
--
-- 5. extension_in_public (pg_trgm): intentionally NOT moved. Relocating
--    it would break the trigram indexes/operator classes that reference
--    it. Accepted risk.
-- ============================================================


-- ── 1. Pin search_path on mutable-search_path functions ─────

DO $$
DECLARE
  sig  TEXT;
  fn   REGPROCEDURE;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.trigger_set_updated_at()',
    'public.trigger_sync_remaining_qty()',
    'public.current_dept()',
    'public.trigger_set_print_run_number()',
    'public.job_card_period(timestamp with time zone)',
    'public.trigger_set_job_card_number()',
    'public.default_printing_unit(text)',
    'public.trigger_set_job_printing_unit()',
    'public.trigger_touch_label_stock()',
    'public.trigger_touch_dies()',
    'public.trigger_touch_plates()',
    'public.job_separation_period(timestamp with time zone)',
    'public.trigger_set_job_separation_sr_no()',
    'public.trigger_touch_job_separations()',
    'public.trigger_touch_register_accounts()',
    'public.trigger_touch_register_deals()',
    'public.trim_prepress_todo_logs()',
    'public.trigger_touch_bom_materials()',
    'public.trigger_touch_flatbed_dies()',
    'public.dept_is_super_admin()',
    'public.dept_has_permission(text)',
    'public.trigger_touch_bom_costings()',
    'public.trigger_touch_bom_material_requests()'
  ]
  LOOP
    fn := to_regprocedure(sig);
    IF fn IS NULL THEN
      RAISE NOTICE '066: % not present, skipping search_path pin', sig;
    ELSE
      EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', fn);
    END IF;
  END LOOP;
END
$$;


-- ── 2. SECURITY DEFINER functions: no EXECUTE for anon ─────
-- Revoke from PUBLIC too: anon inherits PUBLIC's EXECUTE, so revoking
-- from anon alone would leave the function callable.

REVOKE EXECUTE ON FUNCTION public.current_dept()                           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dept_has_permission(text)                FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dept_is_super_admin()                    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_conversation_participant(uuid)        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.log_shade_card_status()                  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.trim_dispatch_notification_history()     FROM PUBLIC, anon;

-- RLS policies for authenticated call the first four; keep them working.
GRANT EXECUTE ON FUNCTION public.current_dept()                            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dept_has_permission(text)                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dept_is_super_admin()                     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_conversation_participant(uuid)         TO authenticated, service_role;
-- Trigger functions fire regardless of EXECUTE; service_role only.
GRANT EXECUTE ON FUNCTION public.log_shade_card_status()                   TO service_role;
GRANT EXECUTE ON FUNCTION public.trim_dispatch_notification_history()      TO service_role;


-- ── 3. Client portal views ──────────────────────────────────

-- 3a. client_job_view / client_status_log_view stay SECURITY DEFINER
-- (the anon /track portal depends on it) but become read-only.
-- REVOKE ALL (not a list) so PG17's MAINTAIN privilege goes too.
REVOKE ALL ON public.client_job_view, public.client_status_log_view
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.client_job_view, public.client_status_log_view TO anon, authenticated;

COMMENT ON VIEW public.client_job_view IS
  'Client portal (/track) read model. Deliberately SECURITY DEFINER: the anon '
  'portal reads it directly and anon has no RLS access to jobs. SELECT-only for '
  'anon/authenticated (066). Read by src/app/track/[po]/page.tsx.';
COMMENT ON VIEW public.client_status_log_view IS
  'Client portal (/track) status history. Deliberately SECURITY DEFINER for the '
  'anon portal; SELECT-only (066). Read by src/app/track/[po]/page.tsx.';

-- 3b. client_print_run_stage_log_view: unused by the app. Make it
-- invoker-rights and drop anon access. Only exists on the live DB.
DO $$
BEGIN
  IF to_regclass('public.client_print_run_stage_log_view') IS NOT NULL THEN
    ALTER VIEW public.client_print_run_stage_log_view SET (security_invoker = true);
    REVOKE ALL ON public.client_print_run_stage_log_view FROM PUBLIC, anon, authenticated;
    GRANT SELECT ON public.client_print_run_stage_log_view TO authenticated;
  ELSE
    RAISE NOTICE '066: client_print_run_stage_log_view not present, skipping';
  END IF;
END
$$;


-- ── 4. RLS enabled, no policies: deny-all by design ─────────

COMMENT ON TABLE public.company_settings IS
  'RLS on, no policies on purpose: deny-all for anon/authenticated. Read and '
  'written only via the service-role client (src/lib/branding.ts, '
  'src/app/api/settings/branding/**).';
COMMENT ON TABLE public.job_card_counters IS
  'RLS on, no policies on purpose: deny-all for anon/authenticated. Written only '
  'by trigger_set_job_card_number() on job inserts, which go through the '
  'service-role client.';
COMMENT ON TABLE public.job_separation_counters IS
  'RLS on, no policies on purpose: deny-all for anon/authenticated. Written only '
  'by trigger_set_job_separation_sr_no() on inserts via the service-role client.';
COMMENT ON TABLE public.machine_queue_items IS
  'RLS on, no policies on purpose: deny-all for anon/authenticated. Accessed only '
  'via the service-role client in src/app/api/machines/** and src/lib/api/machine*.ts.';
COMMENT ON TABLE public.machines IS
  'RLS on, no policies on purpose: deny-all for anon/authenticated. Accessed only '
  'via the service-role client in src/app/api/machines/** and src/lib/api/machine*.ts.';


-- ── 5. pg_trgm stays in public (see header) ─────────────────
