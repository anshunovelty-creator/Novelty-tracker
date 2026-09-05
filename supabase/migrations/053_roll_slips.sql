-- ============================================================
-- NOVELTY LABELS JOB TRACKING SYSTEM
-- Migration 053: roll_slips
-- ============================================================
-- The companion to 052_box_slips: replaces BarTender's
-- "ROLL SLIP 4X6 INCH.btw" (misnamed — the artwork is 76.2 x 32.2 mm).
--
-- The BarTender original prints PM CODE and QUANTITY as literal "<Empty>"
-- placeholders, because nothing fills them: the operator retypes both into
-- the template for every job. Both live on the job already, which is the
-- whole reason for this table.
--
-- Same batch model as box_slips: one row is one print run of identical
-- slips, `roll_count` of them, one per physical roll.
-- ============================================================

CREATE TABLE roll_slips (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- SET NULL rather than CASCADE, as with box_slips and label_stock: a
  -- purged job must not erase the record of rolls that physically shipped.
  job_id            UUID REFERENCES jobs(id) ON DELETE SET NULL,

  -- Snapshot at print time, so a reprint reproduces the slip that was stuck
  -- on the roll even after the job is corrected, closed or purged.
  party             TEXT NOT NULL,
  product           TEXT NOT NULL,     -- printed as PRODUCT; seeded from jobs.job_name
  pm_code           TEXT,              -- printed as PM CODE; NULL prints blank, never "null"
  po_number         TEXT,              -- not printed; carried for the QR tracking link
  job_card_number   TEXT,

  -- What Dispatch supplies. QUANTITY prints as "<qty_per_roll> NOS".
  qty_per_roll      INTEGER NOT NULL CHECK (qty_per_roll > 0),
  roll_count        INTEGER NOT NULL CHECK (roll_count > 0),
  total_qty         INTEGER GENERATED ALWAYS AS (qty_per_roll * roll_count) STORED,

  -- Winding direction, printed as "Direction:#4". Free text rather than a
  -- 1-8 enum: the printed original is free-form and a constraint here would
  -- reject a legitimate value at the worst possible moment, with a packed
  -- consignment waiting.
  direction         TEXT,
  operator          TEXT,              -- printed as "Operator:N & BH"

  -- Printed under SUPPLIER in DD-MM-YYYY. Stored as a real date so it stays
  -- sortable and locale-proof; the display format lives in the renderer.
  slip_date         DATE NOT NULL,

  printed_by        TEXT,              -- department key of whoever hit Print
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_roll_slips_job_id     ON roll_slips (job_id);
CREATE INDEX idx_roll_slips_created_at ON roll_slips (created_at DESC);


-- ============================================================
-- RLS — mirrors box_slips exactly
-- ============================================================
ALTER TABLE roll_slips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "roll_slips_select_authenticated"
  ON roll_slips FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "roll_slips_insert_permitted"
  ON roll_slips FOR INSERT
  TO authenticated
  WITH CHECK (dept_has_permission('roll_slip_print'));

-- No UPDATE policy, for the same reason as box_slips: a printed slip records
-- what was physically stuck on a roll. Correcting it means printing again.
CREATE POLICY "roll_slips_delete_super_admin"
  ON roll_slips FOR DELETE
  TO authenticated
  USING (dept_is_super_admin());


-- ============================================================
-- Seed: who may print roll slips
-- ============================================================
-- Dispatch, matching box_slip_print. Super admins short-circuit in
-- departments.ts and need no row.
INSERT INTO department_feature_permissions (department_id, feature_key)
SELECT id, 'roll_slip_print' FROM departments WHERE key = 'Dispatch'
ON CONFLICT DO NOTHING;


COMMENT ON TABLE roll_slips IS
  'One row per roll-slip print batch. Replaces BarTender ROLL SLIP 4X6 INCH.btw (76.2 x 32.2 mm) — see docs/printing-reference/.';
COMMENT ON COLUMN roll_slips.direction IS
  'Winding direction as printed, e.g. "#4". Free text — the printed original is free-form.';
