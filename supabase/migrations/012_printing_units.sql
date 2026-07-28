-- ============================================================
-- 012_printing_units.sql
-- Printing units + per-job printing method.
--
-- Admin creates units in the admin panel: a name ('Unit-1') plus the
-- printing method that unit runs ('Offset' | 'Flexo').
--
-- A job carries its own printing_method, defaulting to 'Flexo' at
-- creation. Setting the method auto-selects that method's default unit;
-- prepress/production can then override the unit on the job card.
-- ============================================================


-- ============================================================
-- TABLE: printing_units
-- ============================================================
CREATE TABLE IF NOT EXISTS printing_units (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name             TEXT NOT NULL UNIQUE,          -- 'Unit-1'
  printing_method  TEXT NOT NULL
                     CHECK (printing_method IN ('Offset', 'Flexo')),
  -- Lowest sort_order among active units of a method is that method's
  -- default. Ties break on created_at then id so the pick is total and
  -- never flips between calls.
  sort_order       INTEGER NOT NULL DEFAULT 0,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_printing_units_method_active
  ON printing_units (printing_method, is_active, sort_order);

DROP TRIGGER IF EXISTS set_printing_units_updated_at ON printing_units;
CREATE TRIGGER set_printing_units_updated_at
  BEFORE UPDATE ON printing_units
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();


-- ── Seed the two units described by the prepress team ─────────
-- Named exactly as the floor refers to them. Admin can rename these,
-- deactivate them, or add more from the admin panel — nothing below
-- hard-codes these rows.
INSERT INTO printing_units (name, printing_method, sort_order)
VALUES
  ('Unit-1', 'Offset', 1),
  ('Unit-2', 'Flexo',  2)
ON CONFLICT (name) DO NOTHING;


-- ============================================================
-- JOBS: printing method + assigned unit
-- ============================================================
-- ADD COLUMN with a DEFAULT backfills every existing row to 'Flexo',
-- which is the requested initial state, so no separate backfill is
-- needed for the method.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS printing_method TEXT NOT NULL DEFAULT 'Flexo';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'jobs_printing_method_check'
  ) THEN
    ALTER TABLE jobs
      ADD CONSTRAINT jobs_printing_method_check
      CHECK (printing_method IN ('Offset', 'Flexo'));
  END IF;
END $$;

-- ON DELETE SET NULL, not CASCADE: retiring a unit must never delete
-- the jobs that ran on it. The job falls back to "no unit assigned"
-- and can be reassigned.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS printing_unit_id UUID
  REFERENCES printing_units(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_printing_unit_id ON jobs (printing_unit_id);


-- ── Default-unit resolution ───────────────────────────────────
CREATE OR REPLACE FUNCTION default_printing_unit(p_method TEXT)
RETURNS UUID AS $$
  SELECT id
    FROM printing_units
   WHERE printing_method = p_method
     AND is_active
   ORDER BY sort_order, created_at, id
   LIMIT 1;
$$ LANGUAGE sql STABLE;


-- ── Assignment trigger ────────────────────────────────────────
CREATE OR REPLACE FUNCTION trigger_set_job_printing_unit()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Only fill an unassigned unit, so a caller that names a unit
    -- explicitly at creation keeps it.
    IF NEW.printing_unit_id IS NULL THEN
      NEW.printing_unit_id := default_printing_unit(NEW.printing_method);
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Method changed and the caller did NOT also set a unit in the same
    -- statement => snap to the new method's default. If the caller did
    -- set a unit, that is an explicit override and wins. This is what
    -- lets prepress park an Offset job on a Flexo unit deliberately
    -- without the trigger yanking it back.
    IF NEW.printing_method IS DISTINCT FROM OLD.printing_method
       AND NEW.printing_unit_id IS NOT DISTINCT FROM OLD.printing_unit_id THEN
      NEW.printing_unit_id := default_printing_unit(NEW.printing_method);
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_job_printing_unit ON jobs;
CREATE TRIGGER set_job_printing_unit
  BEFORE INSERT OR UPDATE OF printing_method, printing_unit_id ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_job_printing_unit();


-- ── Backfill units for pre-existing jobs ──────────────────────
-- Every existing row was just defaulted to 'Flexo' by the ADD COLUMN
-- above; point them at the Flexo unit. Guarded on NULL so re-running
-- this migration never reassigns a job someone has since moved.
UPDATE jobs
   SET printing_unit_id = default_printing_unit(printing_method)
 WHERE printing_unit_id IS NULL;


-- ── Row Level Security ────────────────────────────────────────
-- Mirrors the posture of the other operational tables: authenticated
-- staff read; writes go through the service-role admin client in the
-- API layer, which is where department authorisation is enforced.
ALTER TABLE printing_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "printing_units_select_authenticated" ON printing_units;
CREATE POLICY "printing_units_select_authenticated"
  ON printing_units FOR SELECT
  TO authenticated
  USING (true);
