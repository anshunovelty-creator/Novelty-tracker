-- ============================================================
-- 031_bom_requests.sql
-- Bill of Material (BOM) requisitions — replaces the mail thread
-- Production used to send the owner when they needed paper or rolls.
--
-- Shape: one request is a header (who raised it, what job it's for, when
-- it's needed) plus many material line items, because a single "I need
-- stock for this job" is almost never one material. The admin decision
-- lives on the LINE, not the request: that's what makes partial ordering
-- and "use this alternative instead" expressible at all. The request's own
-- status is never written by hand — it is rolled up from its items by
-- trigger (see recalc_bom_request_status below), so the pending badge and
-- any filter can trust a single indexed column.
--
-- Visibility is Production + Admin only, the tightest gate in the app after
-- Register's Admin-only. RLS restricts SELECT to those two departments;
-- writes go through the service-role client in the API layer, gated by
-- canDeptUseBOM / canDeptDecideBOM. Prepress, QC, Postpress, Dispatch and
-- Viewer get nothing: no nav item, no page, no rows.
-- ============================================================

-- Human-facing reference (BOM-0001) — the thing the floor and the owner say
-- out loud. Separate from the UUID so it stays short and ordered.
CREATE SEQUENCE IF NOT EXISTS bom_request_ref_seq;

CREATE TABLE IF NOT EXISTS bom_requests (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref        TEXT NOT NULL UNIQUE
               DEFAULT ('BOM-' || LPAD(nextval('bom_request_ref_seq')::TEXT, 4, '0')),

  -- Free text, not a jobs FK: a request is often for a PO ("PO-1187") but is
  -- just as often a general top-up with no job at all, and Production should
  -- never have to go find a job row before they can ask for paper.
  job_po     TEXT,
  party      TEXT,
  needed_by  DATE,
  priority   TEXT NOT NULL DEFAULT 'normal'
               CHECK (priority IN ('normal', 'urgent')),
  note       TEXT,

  -- Derived from the items by trigger. 'cancelled' is the one terminal
  -- state the rollup will not overwrite — see recalc_bom_request_status.
  status     TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN (
                 'pending',              -- nothing decided yet
                 'in_review',            -- some lines decided, some still open
                 'ordered',              -- every line ordered in full
                 'partially_fulfilled',  -- mixed outcome across the lines
                 'rejected',             -- every line rejected
                 'cancelled'             -- withdrawn by the raiser or Admin
               )),

  raised_by_department TEXT NOT NULL,
  raised_by            TEXT,
  cancelled_at         TIMESTAMPTZ,
  cancelled_by         TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bom_request_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    UUID NOT NULL REFERENCES bom_requests(id) ON DELETE CASCADE,

  -- Display order as typed on the form; ties broken by created_at.
  position      INT NOT NULL DEFAULT 1,

  material      TEXT NOT NULL,   -- "Chromo Paper 80gsm", "Metallic Poly"
  specification TEXT,            -- gsm / micron / finish
  size          TEXT,            -- "320mm", kept text: widths arrive as "320 x 450"
  quantity      NUMERIC(12,2),
  unit          TEXT,            -- rolls / kg / sheets / reams
  note          TEXT,

  -- The owner's answer for THIS line. 'partial' pairs with approved_quantity;
  -- 'alternative' pairs with alternative_material. Both are advisory at the
  -- DB level (a CHECK would block saving a half-filled decision mid-edit);
  -- the API enforces the pairing on write.
  decision      TEXT NOT NULL DEFAULT 'pending'
                  CHECK (decision IN ('pending', 'ordered', 'partial', 'alternative', 'rejected')),
  approved_quantity    NUMERIC(12,2),
  alternative_material TEXT,
  decision_note        TEXT,
  decided_at    TIMESTAMPTZ,
  decided_by    TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The list view's default query is "open requests, newest first"; the nav
-- badge counts status = 'pending'. Both ride this index.
CREATE INDEX IF NOT EXISTS idx_bom_requests_status_created
  ON bom_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bom_requests_created
  ON bom_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bom_request_items_request
  ON bom_request_items (request_id, position);

-- ── updated_at maintenance ────────────────────────────────────
CREATE OR REPLACE FUNCTION trigger_touch_bom_requests()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS touch_bom_requests ON bom_requests;
CREATE TRIGGER touch_bom_requests
  BEFORE UPDATE ON bom_requests
  FOR EACH ROW
  EXECUTE FUNCTION trigger_touch_bom_requests();

CREATE OR REPLACE FUNCTION trigger_touch_bom_request_items()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS touch_bom_request_items ON bom_request_items;
CREATE TRIGGER touch_bom_request_items
  BEFORE UPDATE ON bom_request_items
  FOR EACH ROW
  EXECUTE FUNCTION trigger_touch_bom_request_items();

-- ── Request status rollup ─────────────────────────────────────
-- Keeps bom_requests.status honest without the API ever computing it, so
-- two admins deciding two lines at once can't race each other into a wrong
-- header state. Runs after any item insert/update/delete.
CREATE OR REPLACE FUNCTION recalc_bom_request_status()
RETURNS TRIGGER AS $$
DECLARE
  target_id   UUID;
  total       INT;
  undecided   INT;
  rejected    INT;
  ordered     INT;
  next_status TEXT;
BEGIN
  target_id := COALESCE(NEW.request_id, OLD.request_id);

  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE decision = 'pending'),
         COUNT(*) FILTER (WHERE decision = 'rejected'),
         COUNT(*) FILTER (WHERE decision = 'ordered')
    INTO total, undecided, rejected, ordered
    FROM bom_request_items
   WHERE request_id = target_id;

  IF total = 0 THEN
    next_status := 'pending';
  ELSIF undecided = total THEN
    next_status := 'pending';
  ELSIF undecided > 0 THEN
    next_status := 'in_review';
  ELSIF rejected = total THEN
    next_status := 'rejected';
  ELSIF ordered = total THEN
    next_status := 'ordered';
  ELSE
    -- Every line answered, but the answers differ: some ordered, some cut
    -- short, some swapped, some refused. That is the normal outcome.
    next_status := 'partially_fulfilled';
  END IF;

  -- A withdrawn request stays withdrawn; deciding its leftover lines must
  -- not quietly resurrect it into the owner's queue.
  UPDATE bom_requests
     SET status = next_status
   WHERE id = target_id
     AND status <> 'cancelled'
     AND status <> next_status;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS rollup_bom_request_status ON bom_request_items;
CREATE TRIGGER rollup_bom_request_status
  AFTER INSERT OR UPDATE OR DELETE ON bom_request_items
  FOR EACH ROW
  EXECUTE FUNCTION recalc_bom_request_status();

-- ── Row Level Security ────────────────────────────────────────
-- Production raises and tracks; Admin decides. Nobody else sees a row —
-- including Viewer, which reads every other table in the app.
ALTER TABLE bom_requests      ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_request_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bom_requests_select_prod_admin" ON bom_requests;
CREATE POLICY "bom_requests_select_prod_admin"
  ON bom_requests FOR SELECT
  TO authenticated
  USING ((auth.jwt() -> 'user_metadata' ->> 'department') IN ('Admin', 'Production'));

DROP POLICY IF EXISTS "bom_request_items_select_prod_admin" ON bom_request_items;
CREATE POLICY "bom_request_items_select_prod_admin"
  ON bom_request_items FOR SELECT
  TO authenticated
  USING ((auth.jwt() -> 'user_metadata' ->> 'department') IN ('Admin', 'Production'));
