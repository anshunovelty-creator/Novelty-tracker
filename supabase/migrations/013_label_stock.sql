-- ============================================================
-- 013_label_stock.sql
-- Physical stock of printed labels sitting in the shop.
--
-- Three ways stock appears, and they mean different things:
--
--   'Remaining' — the order was partially dispatched, so the balance of
--                 the printed run is still on the shelf. One row per job,
--                 recomputed on each partial dispatch, cleared when the
--                 job is fully dispatched (the labels left the building).
--
--   'Extra'     — surplus beyond the order quantity. The press over-ran,
--                 or a reprint left spares. Captured by Dispatch at full
--                 dispatch and NOT cleared by it — that is the whole point
--                 of tracking it.
--
--   'Manual'    — someone found stock the system never knew about.
--
-- Job identity is snapshotted onto the row rather than always read through
-- the join. Stock outlives the job it came from: a PO closed and purged a
-- year later must not silently blank the shelf record of 40,000 labels.
-- job_id is kept (nullable) so live rows can still be traced to the job.
-- ============================================================

CREATE TABLE IF NOT EXISTS label_stock (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- SET NULL, not CASCADE: deleting a job must not erase the record of
  -- labels that physically exist on a shelf.
  job_id            UUID REFERENCES jobs(id) ON DELETE SET NULL,

  kind              TEXT NOT NULL DEFAULT 'Manual'
                      CHECK (kind IN ('Remaining', 'Extra', 'Manual')),

  qty               INTEGER NOT NULL CHECK (qty > 0),

  -- Snapshot of the job at the moment the stock was recorded.
  job_card_number   TEXT,
  po_number         TEXT,
  pm_code           TEXT,
  party             TEXT NOT NULL,
  job_name          TEXT,

  location          TEXT,          -- optional: rack / shelf / bay
  remark            TEXT,          -- optional

  -- Soft removal. "Dispatched" stock leaves the live list but stays
  -- auditable — the question is always "where did those labels go".
  is_dispatched     BOOLEAN NOT NULL DEFAULT FALSE,
  dispatched_at     TIMESTAMPTZ,
  dispatched_by     TEXT,

  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The live stock list is the hot path: everything not yet dispatched,
-- newest first.
CREATE INDEX IF NOT EXISTS idx_label_stock_live
  ON label_stock (is_dispatched, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_label_stock_job
  ON label_stock (job_id);

-- At most ONE live 'Remaining' row per job. The partial-dispatch handler
-- upserts against this: a second partial dispatch updates the existing
-- balance instead of stacking another row on the shelf.
CREATE UNIQUE INDEX IF NOT EXISTS idx_label_stock_one_remaining_per_job
  ON label_stock (job_id)
  WHERE kind = 'Remaining' AND is_dispatched = FALSE;


-- ── updated_at maintenance ────────────────────────────────────
CREATE OR REPLACE FUNCTION trigger_touch_label_stock()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS touch_label_stock ON label_stock;
CREATE TRIGGER touch_label_stock
  BEFORE UPDATE ON label_stock
  FOR EACH ROW
  EXECUTE FUNCTION trigger_touch_label_stock();


-- ── Row Level Security ────────────────────────────────────────
-- Mirrors the posture of the other operational tables: authenticated
-- staff read (anyone may look up stock for a job); writes go through the
-- service-role admin client in the API layer, which is where department
-- authorisation is enforced.
ALTER TABLE label_stock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "label_stock_select_authenticated" ON label_stock;
CREATE POLICY "label_stock_select_authenticated"
  ON label_stock FOR SELECT
  TO authenticated
  USING (true);
