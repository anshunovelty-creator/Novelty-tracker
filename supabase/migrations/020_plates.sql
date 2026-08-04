-- ============================================================
-- 020_plates.sql
-- Printing plates mounted on press cylinders.
--
-- Prepress keeps this list by hand — until now, in a spreadsheet. A plate is
-- a physical object on a rack, made once for a party's item and reused every
-- time that item is printed again. The question this table answers is the one
-- shouted across the floor: "do we already have a plate for this, and where
-- is it?"
--
-- Two identifiers, and they are not the same thing:
--   id       — this row's primary key, ours, meaningless on the shop floor.
--   plate_id — the serial etched into the physical plate. Unique when set,
--              but nullable: a plate is often recorded before it comes back
--              from etching, and refusing the record until then would just
--              push the data back into the spreadsheet.
--
-- Column order follows the source Excel sheet Prepress has been maintaining,
-- so a row here reads the same left-to-right as the sheet it replaces.
-- Sizes stay TEXT — the sheet holds things like '3.5"' and '95mm', and
-- normalising them would lose what someone actually measured.
-- ============================================================

CREATE TABLE IF NOT EXISTS plates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  party             TEXT NOT NULL,
  pm_code           TEXT,
  item_name         TEXT,
  across_size       TEXT,          -- ACROSS SIZE (H)
  around_size       TEXT,          -- AROUND SIZE (W)
  cylinder          INTEGER,
  plate_id          TEXT,          -- serial etched on the plate; see above
  plate_date        DATE,
  label_per_round   INTEGER,
  location          TEXT,          -- rack / shelf / bay

  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The list view is the hot path: everything, newest first.
CREATE INDEX IF NOT EXISTS idx_plates_created
  ON plates (created_at DESC);

-- One row per etched serial. Partial, so the many not-yet-etched plates do
-- not collide with each other on NULL. Case-insensitive: Prepress hand-types
-- this from the spreadsheet, and 'AB-1024' / 'ab-1024' are the same physical
-- plate, not two.
CREATE UNIQUE INDEX IF NOT EXISTS idx_plates_plate_id
  ON plates (lower(plate_id))
  WHERE plate_id IS NOT NULL;


-- ── updated_at maintenance ────────────────────────────────────
CREATE OR REPLACE FUNCTION trigger_touch_plates()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS touch_plates ON plates;
CREATE TRIGGER touch_plates
  BEFORE UPDATE ON plates
  FOR EACH ROW
  EXECUTE FUNCTION trigger_touch_plates();


-- ── Row Level Security ────────────────────────────────────────
-- Same posture as label_stock: every authenticated department may look a
-- plate up, because anyone about to print needs to know whether one exists.
-- Writes go through the service-role admin client in the API layer, which is
-- where the Prepress/Admin restriction is enforced.
ALTER TABLE plates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plates_select_authenticated" ON plates;
CREATE POLICY "plates_select_authenticated"
  ON plates FOR SELECT
  TO authenticated
  USING (true);
