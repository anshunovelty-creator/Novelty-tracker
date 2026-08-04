-- ============================================================
-- 019_dies.sql
-- The die library — the physical cutting dies that punch a label's
-- shape out of the printed web.
--
-- A die is a tool, not a job. It is cut once for a product and then
-- reused every time that product reprints, so the question this table
-- answers is "do we already own a die for this, and where is it".
-- The columns are the sheet Prepress has always kept by hand: the job
-- the die was cut for, its geometry (length, width, cylinder, ups, gap,
-- corner), the material it runs on, the serial etched on the die itself,
-- and the date it came back from the die maker.
--
-- Nothing references this table. A die record is a reference entry, not
-- part of the job pipeline — mis-entries and duplicates are corrected or
-- deleted outright rather than soft-removed.
-- ============================================================

CREATE TABLE IF NOT EXISTS dies (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Column order mirrors the source sheet, so a row here reads the same
  -- way the Prepress spreadsheet always has.
  job_name          TEXT NOT NULL,
  length            TEXT,          -- free text: the sheet mixes units
  width             TEXT,          -- often a combined "H x W" reading
  cylinder          INTEGER,
  material          TEXT,
  ups               INTEGER,       -- labels per revolution
  gap               TEXT,          -- e.g. "5 MM"
  corner            TEXT,          -- e.g. "SPECIAL", "ROUND"

  -- Etched on the die. Nullable: a die can be logged before its serial
  -- is known, but two dies must never claim the same one.
  serial_no         TEXT,

  die_received_on   DATE,

  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The list is the hot path: newest first, filtered by search.
CREATE INDEX IF NOT EXISTS idx_dies_created
  ON dies (created_at DESC);

-- Partial, so any number of dies may sit without a serial while the ones
-- that have a serial stay unique on it. Case-insensitive, same reasoning as
-- plates.plate_id: this is hand-typed from the spreadsheet, and
-- 'BNK26-04-39215' / 'bnk26-04-39215' are the same physical die, not two.
CREATE UNIQUE INDEX IF NOT EXISTS idx_dies_serial_no
  ON dies (lower(serial_no))
  WHERE serial_no IS NOT NULL;


-- ── updated_at maintenance ────────────────────────────────────
CREATE OR REPLACE FUNCTION trigger_touch_dies()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS touch_dies ON dies;
CREATE TRIGGER touch_dies
  BEFORE UPDATE ON dies
  FOR EACH ROW
  EXECUTE FUNCTION trigger_touch_dies();


-- ── Row Level Security ────────────────────────────────────────
-- Mirrors the posture of the other operational tables: authenticated
-- staff read (any department may need to know whether a die exists);
-- writes go through the service-role admin client in the API layer,
-- which is where department authorisation is enforced.
ALTER TABLE dies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dies_select_authenticated" ON dies;
CREATE POLICY "dies_select_authenticated"
  ON dies FOR SELECT
  TO authenticated
  USING (true);
