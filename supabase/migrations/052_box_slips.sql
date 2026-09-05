-- ============================================================
-- NOVELTY LABELS JOB TRACKING SYSTEM
-- Migration 052: box_slips
-- ============================================================
-- Replaces the BarTender "BOX SLIP 4X6 INCH.btw" template.
--
-- The slips themselves are printed straight from the app (152.4 x 101.6 mm
-- on the TSC P210 at 203 dpi) — this table is what makes that possible
-- without retyping: party, material name and PM code come off the job, and
-- Dispatch only supplies what the app cannot know (how many labels went in
-- a box, how many boxes, and the manufacturing date).
--
-- One row = one print batch, not one physical box. `box_count` identical
-- slips come out of the printer; the row records the batch so a torn or
-- smudged slip can be reprinted verbatim months later.
-- ============================================================

CREATE TABLE box_slips (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- SET NULL, not CASCADE: the same reasoning as label_stock (migration 013).
  -- A purged job must not erase the record of boxes that physically shipped.
  job_id            UUID REFERENCES jobs(id) ON DELETE SET NULL,

  -- Snapshot of the job at print time. Deliberately copied rather than
  -- joined: a reprint must reproduce the slip that was stuck on the box,
  -- even if the job has since been corrected or the PO closed and purged.
  party             TEXT NOT NULL,
  material_name     TEXT NOT NULL,     -- printed under MATERIAL NAME; seeded from jobs.job_name
  pm_code           TEXT,              -- printed as PM CODE; NULL prints blank, never the word "null"
  po_number         TEXT,
  job_card_number   TEXT,

  -- What Dispatch supplies. The slip prints these as
  --   PACK SIZE : <qty_per_box> X <box_count> BOX = <total_qty>
  --   QUANTITY  : <qty_per_box> X <box_count> BOX
  qty_per_box       INTEGER NOT NULL CHECK (qty_per_box > 0),
  box_count         INTEGER NOT NULL CHECK (box_count > 0),
  total_qty         INTEGER GENERATED ALWAYS AS (qty_per_box * box_count) STORED,

  -- Printed as MFG DATE in DD-MM-YYYY. Stored as a real date so it stays
  -- sortable and locale-proof; the display format lives in the renderer.
  mfg_date          DATE NOT NULL,

  printed_by        TEXT,              -- department key of whoever hit Print
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The two hot paths: "what did we print for this job" (reprint from the job)
-- and "what did we print today" (the batch list on the box-slip page).
CREATE INDEX idx_box_slips_job_id     ON box_slips (job_id);
CREATE INDEX idx_box_slips_created_at ON box_slips (created_at DESC);


-- ============================================================
-- RLS
-- ============================================================
-- Reading is open to every authenticated user: anyone who finds a slip on a
-- box should be able to look up what it was. Writing is gated on the new
-- box_slip_print feature, same shape as every other permission since 040.
ALTER TABLE box_slips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "box_slips_select_authenticated"
  ON box_slips FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "box_slips_insert_permitted"
  ON box_slips FOR INSERT
  TO authenticated
  WITH CHECK (dept_has_permission('box_slip_print'));

-- Deliberately no UPDATE policy: a printed slip is a record of what was
-- physically stuck on a box. Getting it wrong means printing a corrected
-- batch, not editing history. DELETE is likewise super-admin only, for
-- clearing a genuine mis-entry before the box ships.
CREATE POLICY "box_slips_delete_super_admin"
  ON box_slips FOR DELETE
  TO authenticated
  USING (dept_is_super_admin());


-- ============================================================
-- Seed: who may print box slips
-- ============================================================
-- Dispatch, because they are the ones filling in box counts and winding
-- direction today. Super admins are covered by the isSuperAdmin short-circuit
-- in departments.ts and need no row here.
INSERT INTO department_feature_permissions (department_id, feature_key)
SELECT id, 'box_slip_print' FROM departments WHERE key = 'Dispatch'
ON CONFLICT DO NOTHING;


COMMENT ON TABLE box_slips IS
  'One row per box-slip print batch. Replaces BarTender BOX SLIP 4X6 INCH.btw — see docs/printing-reference/.';
COMMENT ON COLUMN box_slips.box_count IS
  'Number of identical slips printed in this batch: one per physical box.';
