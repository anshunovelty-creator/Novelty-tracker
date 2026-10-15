-- ============================================================
-- 082_report_fingerprint.sql
-- The order book's totals, per month, as the database itself adds them up.
--
-- The Reports page keeps every Job Separation row in memory and, after
-- the first load, fetches only rows changed since its last sync. This is
-- the check on that cache: GET /api/reports sends these totals with every
-- sync; the page adds up its own copy the same way and, on any mismatch,
-- throws the cache away and reloads everything.
--
-- A row's month is its PO date's, or created_at's IST day for the few
-- legacy rows without one — the same day /api/reports gives it.
--
-- Read-only. Called by the API with the service role; nobody else.
-- ============================================================

CREATE OR REPLACE FUNCTION report_fingerprint()
RETURNS TABLE (month TEXT, lines BIGINT, cancelled BIGINT, value NUMERIC, qty BIGINT)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    to_char(COALESCE(po_date, (created_at AT TIME ZONE 'Asia/Kolkata')::date), 'YYYY-MM'),
    count(*) FILTER (WHERE cancelled_at IS NULL),
    count(*) FILTER (WHERE cancelled_at IS NOT NULL),
    COALESCE(sum(order_value) FILTER (WHERE cancelled_at IS NULL), 0),
    COALESCE(sum(quantity)    FILTER (WHERE cancelled_at IS NULL), 0)
  FROM job_separations
  GROUP BY 1
  ORDER BY 1;
$$;

REVOKE ALL ON FUNCTION report_fingerprint() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION report_fingerprint() TO service_role;
