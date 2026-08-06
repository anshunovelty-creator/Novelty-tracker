-- ============================================================
-- 022_job_separations.sql
-- Job Separation — the Prepress worksheet that splits an incoming PO into
-- individually trackable line items (material, PM code, rate, quantity)
-- ahead of job-card creation. Requested so the whole shop can search and
-- watch it live; only Prepress and Admin enter or correct a row.
--
-- Column order mirrors the source sheet (Sr. No., Party, Po No, Po Date,
-- PM Code, Material Name, Quantity, Unit, Job Status, Rate, Order Value,
-- JC Status, AW send to), so a row here reads the same way the sheet does.
-- ============================================================

CREATE TABLE IF NOT EXISTS job_separations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Auto-assigned by the trigger below, e.g. AUG26-1. Nullable only so an
  -- explicit value (import / manual correction) can be supplied instead —
  -- see trigger_set_job_separation_sr_no.
  sr_no           TEXT,

  party           TEXT NOT NULL,
  po_no           TEXT,
  po_date         DATE,
  pm_code         TEXT,
  material_name   TEXT,
  quantity        INTEGER,
  unit            TEXT,             -- '1' | '2' | '1&2' — which printing unit(s)
  job_status      TEXT,

  rate            NUMERIC(12,2),
  -- Derived, not entered: keeping it a generated column means it can never
  -- drift from quantity × rate the way a hand-typed total could.
  order_value     NUMERIC(14,2) GENERATED ALWAYS AS (
                     CASE WHEN quantity IS NOT NULL AND rate IS NOT NULL
                          THEN quantity * rate END
                  ) STORED,

  jc_status       TEXT,             -- e.g. 'DONE'
  aw_send_to      TEXT,             -- e.g. 'REPEAT' — artwork re-send flag

  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The list is the hot path: newest first, filtered by search.
CREATE INDEX IF NOT EXISTS idx_job_separations_created
  ON job_separations (created_at DESC);


-- ============================================================
-- Sr. No. auto-assignment: <MON><YY>-<seq>, e.g. AUG26-1.
-- Mirrors the job_card_number scheme in 011_job_card_numbers.sql (own
-- period counter table, so the two sequences never collide) — see that
-- migration's comments for why an UPSERT counter is used instead of a
-- MAX(seq)+1 read: this counter is global per month, so two clerks
-- adding rows at the same moment would otherwise race on the same MAX.
-- ============================================================
CREATE TABLE IF NOT EXISTS job_separation_counters (
  period    TEXT    PRIMARY KEY,          -- 'AUG26'
  last_seq  INTEGER NOT NULL DEFAULT 0
);

-- STABLE only (not IMMUTABLE): the AT TIME ZONE conversion depends on the
-- timezone database. Evaluated in Asia/Kolkata so a row added just after
-- midnight IST files under the new month, not the old UTC one.
CREATE OR REPLACE FUNCTION job_separation_period(ts TIMESTAMPTZ)
RETURNS TEXT AS $$
  SELECT upper(to_char(ts AT TIME ZONE 'Asia/Kolkata', 'MonYY'));
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION trigger_set_job_separation_sr_no()
RETURNS TRIGGER AS $$
DECLARE
  v_period TEXT;
  v_seq    INTEGER;
BEGIN
  -- An explicitly supplied Sr. No. wins, so imports and manual corrections
  -- can pin a specific value without the trigger overwriting it.
  IF NEW.sr_no IS NOT NULL AND btrim(NEW.sr_no) <> '' THEN
    RETURN NEW;
  END IF;

  v_period := job_separation_period(COALESCE(NEW.created_at, NOW()));

  INSERT INTO job_separation_counters (period, last_seq)
       VALUES (v_period, 1)
  ON CONFLICT (period)
  DO UPDATE SET last_seq = job_separation_counters.last_seq + 1
    RETURNING last_seq INTO v_seq;

  NEW.sr_no := v_period || '-' || v_seq;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_job_separation_sr_no ON job_separations;
CREATE TRIGGER set_job_separation_sr_no
  BEFORE INSERT ON job_separations
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_job_separation_sr_no();

-- Safety net: if the counter is ever bypassed or a Sr. No. hand-edited, a
-- duplicate fails loudly at write time instead of two rows sharing an ID.
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_separations_sr_no
  ON job_separations (sr_no);

CREATE INDEX IF NOT EXISTS idx_job_separations_sr_no_lower
  ON job_separations (lower(sr_no));


-- ── updated_at maintenance ────────────────────────────────────
CREATE OR REPLACE FUNCTION trigger_touch_job_separations()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS touch_job_separations ON job_separations;
CREATE TRIGGER touch_job_separations
  BEFORE UPDATE ON job_separations
  FOR EACH ROW
  EXECUTE FUNCTION trigger_touch_job_separations();


-- ── Row Level Security ────────────────────────────────────────
-- Mirrors dies/plates: authenticated staff read (every department can
-- search and view live); writes go through the service-role admin client
-- in the API layer, which is where Prepress/Admin authorisation lives.
ALTER TABLE job_separations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_separations_select_authenticated" ON job_separations;
CREATE POLICY "job_separations_select_authenticated"
  ON job_separations FOR SELECT
  TO authenticated
  USING (true);
