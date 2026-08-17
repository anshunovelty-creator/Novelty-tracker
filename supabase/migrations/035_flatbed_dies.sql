-- ============================================================
-- 035_flatbed_dies.sql
-- The flatbed die library — the shop's second physical die type, alongside
-- the rotary dies in `dies` (019_dies.sql). A flatbed die is specified
-- differently: no cylinder (it doesn't rotate), but it does have a shape,
-- so this gets its own table rather than more nullable columns bolted onto
-- `dies`.
--
-- Same posture as `dies`: a die record is a reference entry, not part of
-- the job pipeline — mis-entries and duplicates are corrected or deleted
-- outright rather than soft-removed. Status/damage tracking mirrors
-- 021_die_status.sql exactly.
-- ============================================================

CREATE TABLE IF NOT EXISTS flatbed_dies (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  length            TEXT,          -- free text: the sheet mixes units
  width             TEXT,          -- often a combined "H x W" reading
  ups               INTEGER,       -- labels per sheet/stroke
  gap               TEXT,          -- e.g. "5 MM"
  corner            TEXT,          -- corner radius, e.g. "3 MM", "SPECIAL"
  shape             TEXT,          -- e.g. "RECTANGLE", "OVAL"
  location          TEXT,

  die_received_on   DATE,

  -- Same three-state posture as dies.status: 'IN USE' default, 'EXTRA' for
  -- spares, 'DAMAGE' out of rotation with damage_date/damage_reason only
  -- meaningful for that status — enforced together by the API layer.
  status            TEXT NOT NULL DEFAULT 'IN USE'
                       CHECK (status IN ('IN USE', 'EXTRA', 'DAMAGE')),
  damage_date       DATE,
  damage_reason     TEXT,

  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The list is the hot path: newest first, filtered by search.
CREATE INDEX IF NOT EXISTS idx_flatbed_dies_created
  ON flatbed_dies (created_at DESC);


-- ── updated_at maintenance ────────────────────────────────────
CREATE OR REPLACE FUNCTION trigger_touch_flatbed_dies()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS touch_flatbed_dies ON flatbed_dies;
CREATE TRIGGER touch_flatbed_dies
  BEFORE UPDATE ON flatbed_dies
  FOR EACH ROW
  EXECUTE FUNCTION trigger_touch_flatbed_dies();


-- ── Row Level Security ────────────────────────────────────────
-- Mirrors dies: authenticated staff read (any department may need to know
-- whether a flatbed die exists); writes go through the service-role admin
-- client in the API layer, which is where department authorisation is
-- enforced (canDeptManageDiesPlates — same Prepress/Admin gate as dies).
ALTER TABLE flatbed_dies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "flatbed_dies_select_authenticated" ON flatbed_dies;
CREATE POLICY "flatbed_dies_select_authenticated"
  ON flatbed_dies FOR SELECT
  TO authenticated
  USING (true);
