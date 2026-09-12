-- ============================================================
-- 058_bom_costing.sql
-- Bill of Material, second version: an order-versus-material comparison
-- instead of a free-form requisition form.
--
-- The question the owner actually asks of a new PO is "is this order worth
-- taking?" — the answer is the order value from Job Separation next to what
-- the raw material for it will cost. So the BOM is no longer its own list
-- of requests with hand-typed materials, sizes and units; it is Job
-- Separation's rows again, each with three costing inputs the floor fills
-- in (material from a master list, material width in mm, running metres),
-- and a computed expense and difference beside the order value.
--
-- Three tables:
--   bom_materials          — the master list, now carrying ₹ per square
--                            metre. Same table as before (names survive);
--                            the old spec/size/unit defaults are dropped.
--   bom_costings           — one row per Job Separation row: the three
--                            inputs. Expense is NOT stored — it is derived
--                            from the material's *current* rate, so a rate
--                            correction reprices every job at once.
--   bom_material_requests  — "Request" pressed on a costed row. Snapshots
--                            the material, metres, width, rate, expense and
--                            order value as they were when asked, plus the
--                            floor's message, and carries the owner's answer.
--
-- ⚠ DESTRUCTIVE: bom_requests and bom_request_items (the old requisitions)
-- are dropped. Run the data export (/admin/export) first if that history
-- should be kept somewhere.
--
-- Visibility is unchanged: bom_use to read every BOM table, enforced by RLS
-- below and again by canDeptUseBOM in every /api/bom-* route. Writes go
-- through the service-role client, gated in the API layer (bom_use to cost
-- a row and raise a request; bom_decide to answer one or edit the master).
-- ============================================================

-- ── Old requisition flow ──────────────────────────────────────
DROP TABLE IF EXISTS bom_request_items;
DROP TABLE IF EXISTS bom_requests;
DROP FUNCTION IF EXISTS recalc_bom_request_status();
DROP FUNCTION IF EXISTS trigger_touch_bom_requests();
DROP FUNCTION IF EXISTS trigger_touch_bom_request_items();
-- bom_request_ref_seq is kept: the new request table reuses it, so refs
-- keep counting up from where the old ones stopped rather than restarting
-- at BOM-0001 and colliding with numbers people still have on paper.

-- ── Material master ───────────────────────────────────────────
ALTER TABLE bom_materials
  DROP COLUMN IF EXISTS default_size,
  DROP COLUMN IF EXISTS default_unit,
  -- ₹ per square metre. 0 means "rate not entered yet": a material carried
  -- over from the old catalogue, or added in a hurry. The costing UI lists
  -- such a material but will not price a job with it — a ₹0 expense would
  -- read as a perfect margin, which is the one wrong answer this screen
  -- must never give.
  ADD COLUMN IF NOT EXISTS rate_per_sqm NUMERIC(12,4) NOT NULL DEFAULT 0
    CHECK (rate_per_sqm >= 0),
  -- Retired materials stay on the list (old costings still point at them)
  -- but drop out of the dropdown for new entries.
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS updated_by TEXT;

-- ── Costings ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bom_costings (
  -- 1:1 with Job Separation. The PK *is* the FK: a job has one costing,
  -- and it goes when the job row does.
  job_separation_id  UUID PRIMARY KEY REFERENCES job_separations(id) ON DELETE CASCADE,

  -- RESTRICT, not SET NULL: a material somebody has already costed a job
  -- with must be retired (is_active = false), never deleted out from under
  -- that job. The API refuses the delete with a clear message first.
  material_id        UUID REFERENCES bom_materials(id) ON DELETE RESTRICT,
  material_width_mm  NUMERIC(10,2) CHECK (material_width_mm IS NULL OR material_width_mm > 0),
  running_meter      NUMERIC(12,2) CHECK (running_meter     IS NULL OR running_meter     > 0),

  updated_by         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bom_costings_material
  ON bom_costings (material_id);

CREATE OR REPLACE FUNCTION trigger_touch_bom_costings()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS touch_bom_costings ON bom_costings;
CREATE TRIGGER touch_bom_costings
  BEFORE UPDATE ON bom_costings
  FOR EACH ROW
  EXECUTE FUNCTION trigger_touch_bom_costings();

-- ── Material requests ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bom_material_requests (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Human-facing reference (BOM-0042) — what gets said out loud. Continues
  -- the old sequence, see the note at the top.
  ref                TEXT NOT NULL UNIQUE
                       DEFAULT ('BOM-' || LPAD(nextval('bom_request_ref_seq')::TEXT, 4, '0')),

  job_separation_id  UUID NOT NULL REFERENCES job_separations(id) ON DELETE CASCADE,

  -- What was asked for, frozen at the moment of asking. The costing row
  -- can be edited again afterwards and the master rate can change; the
  -- request the owner read and acted on must not shift underneath them.
  material_id        UUID REFERENCES bom_materials(id) ON DELETE SET NULL,
  material_name      TEXT NOT NULL,
  material_width_mm  NUMERIC(10,2) NOT NULL,
  running_meter      NUMERIC(12,2) NOT NULL,
  rate_per_sqm       NUMERIC(12,4) NOT NULL,
  expense            NUMERIC(14,2) NOT NULL,
  order_value        NUMERIC(14,2),

  -- The floor's one line to the owner ("stock is short, need by Friday").
  message            TEXT,

  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'ordered', 'declined', 'cancelled')),
  decision_note      TEXT,
  decided_at         TIMESTAMPTZ,
  decided_by         TEXT,

  requested_by_department TEXT NOT NULL,
  requested_by       TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The inbox's default query is "pending, newest first"; the nav badge
-- counts pending. The costing table looks up the latest request per job.
CREATE INDEX IF NOT EXISTS idx_bom_material_requests_status_created
  ON bom_material_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bom_material_requests_job_created
  ON bom_material_requests (job_separation_id, created_at DESC);

CREATE OR REPLACE FUNCTION trigger_touch_bom_material_requests()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS touch_bom_material_requests ON bom_material_requests;
CREATE TRIGGER touch_bom_material_requests
  BEFORE UPDATE ON bom_material_requests
  FOR EACH ROW
  EXECUTE FUNCTION trigger_touch_bom_material_requests();

-- ── Row Level Security ────────────────────────────────────────
-- Same rule as before: bom_use reads, nobody else sees a row. bom_materials
-- keeps the policy 040 gave it.
ALTER TABLE bom_costings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_material_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bom_costings_select_bom_use" ON bom_costings;
CREATE POLICY "bom_costings_select_bom_use"
  ON bom_costings FOR SELECT TO authenticated
  USING (dept_has_permission('bom_use'));

DROP POLICY IF EXISTS "bom_material_requests_select_bom_use" ON bom_material_requests;
CREATE POLICY "bom_material_requests_select_bom_use"
  ON bom_material_requests FOR SELECT TO authenticated
  USING (dept_has_permission('bom_use'));
