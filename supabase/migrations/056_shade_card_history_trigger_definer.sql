-- ============================================================
-- Migration 056: run the shade card history trigger as its definer
-- ============================================================
-- 055 added shade_card_status_history with RLS enabled and no INSERT policy
-- (intentional: the audit trail should only ever be written by the trigger,
-- never directly from the client). The comment there claimed the trigger
-- "runs as its definer," but log_shade_card_status() was never actually
-- marked SECURITY DEFINER, so it ran as the calling (authenticated) user and
-- got blocked by RLS on every insert/update of shade_cards — "new row
-- violates row-level security policy for table shade_card_status_history".
--
-- Mark it SECURITY DEFINER (matching the pattern used in 044) so it bypasses
-- RLS as intended, and pin search_path so it can't be hijacked by a
-- session-local search_path change.
CREATE OR REPLACE FUNCTION log_shade_card_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO shade_card_status_history
      (shade_card_id, old_status, new_status, changed_by, changed_by_name)
    VALUES (NEW.id, NULL, NEW.status, NEW.created_by, NEW.created_by_name);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO shade_card_status_history
      (shade_card_id, old_status, new_status, changed_by, changed_by_name)
    VALUES (NEW.id, OLD.status, NEW.status, NEW.updated_by, NEW.updated_by_name);
  END IF;
  RETURN NEW;
END;
$$;
