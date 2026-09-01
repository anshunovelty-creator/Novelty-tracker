-- ============================================================
-- 051_job_separation_sr_no_by_po_date.sql
-- Sr. No. now files under the PO's own month, not the month the row was
-- entered — a PO dated 31 Aug added on 1 Sep still gets an AUG26 number, so
-- a stray August PO never gets stuck in September's series just because it
-- was keyed in late. Falls back to created_at only when po_date is absent
-- (the app now requires PO Date on every new row, so this is a safety net
-- for imports/legacy paths, not the normal case).
-- ============================================================

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

  -- po_date is a plain DATE — no time-of-day or timezone to resolve — so
  -- its month is read directly instead of routing through
  -- job_separation_period()'s Asia/Kolkata conversion.
  IF NEW.po_date IS NOT NULL THEN
    v_period := upper(to_char(NEW.po_date, 'MonYY'));
  ELSE
    v_period := job_separation_period(COALESCE(NEW.created_at, NOW()));
  END IF;

  INSERT INTO job_separation_counters (period, last_seq)
       VALUES (v_period, 1)
  ON CONFLICT (period)
  DO UPDATE SET last_seq = job_separation_counters.last_seq + 1
    RETURNING last_seq INTO v_seq;

  NEW.sr_no := v_period || '-' || v_seq;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
