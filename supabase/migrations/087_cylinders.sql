-- ============================================================
-- Migration 087: cylinders
-- ============================================================
-- The press cylinders themselves, one row per cylinder, alongside the
-- plates and dies that run on them (008). Readable by every department,
-- like plates and dies; changed only through the API by departments with
-- the cylinders_edit feature (Admin always).
--
-- Repeat length is teeth × 3.175 mm (1/8" pitch) and is worked out where
-- it's shown, never stored, so it can't drift from the teeth count.
-- ============================================================

CREATE TABLE cylinders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  serial_no       TEXT NOT NULL,
  teeth           INTEGER NOT NULL CHECK (teeth > 0),
  type            TEXT NOT NULL CHECK (type IN ('Print', 'Magnetic')),
  manufacturer    TEXT,
  purchase_date   DATE,

  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per stamped serial; case-insensitive, same reasoning as
-- dies.serial_no.
CREATE UNIQUE INDEX idx_cylinders_serial_no ON cylinders (lower(serial_no));

CREATE TRIGGER touch_cylinders
  BEFORE UPDATE ON cylinders
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();

ALTER TABLE cylinders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cylinders_select_authenticated"
  ON cylinders FOR SELECT
  TO authenticated
  USING (true);
