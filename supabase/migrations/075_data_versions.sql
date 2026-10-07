-- ============================================================
-- 075_data_versions.sql
-- A change counter per table, so a page can ask "has anything changed?"
-- for a few bytes instead of re-downloading its whole list.
--
-- Job Separation and the BOM pages refreshed every 30 s by fetching their
-- full list (~500 rows / ~50 KB) in every open tab, changed or not. Now
-- they poll GET /api/data-versions (one tiny row per table) and fetch the
-- list only when a counter moved (hooks/useDataVersions.ts).
--
-- How it counts: a statement-level trigger on each watched table bumps
-- that table's version after any INSERT, UPDATE or DELETE — whatever made
-- the change (API routes, database functions, the dashboard's SQL editor).
-- Statement-level, so a 500-row import is one bump, not 500.
--
-- Read through the API route with the service role; RLS on, no policies.
-- ============================================================

CREATE TABLE IF NOT EXISTS data_versions (
  name        TEXT PRIMARY KEY,
  version     BIGINT      NOT NULL DEFAULT 0,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE data_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON data_versions FROM anon, authenticated;

-- SECURITY DEFINER: the trigger must be able to bump the counter even when
-- the write that fired it came from a role that can't touch data_versions.
CREATE OR REPLACE FUNCTION bump_data_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO data_versions (name, version, changed_at)
  VALUES (TG_TABLE_NAME, 1, now())
  ON CONFLICT (name) DO UPDATE
    SET version = data_versions.version + 1, changed_at = now();
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION bump_data_version() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'job_separations', 'bom_costings', 'bom_materials',
    'bom_material_requests', 'bom_material_orders', 'paper_stock_movements'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS bump_data_version ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER bump_data_version AFTER INSERT OR UPDATE OR DELETE ON %I '
      'FOR EACH STATEMENT EXECUTE FUNCTION bump_data_version()', t);
    INSERT INTO data_versions (name) VALUES (t) ON CONFLICT DO NOTHING;
  END LOOP;
END $$;
