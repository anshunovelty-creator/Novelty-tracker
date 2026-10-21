-- ============================================================
-- 085_dispatch_ledger.sql
-- Dispatch entries become the record Reports counts dispatched and
-- pending quantities from (agreed 2026-10-21).
--
-- confirmed_at: when the entry starts counting as dispatched. The team
--   emails the internal list only (no party has a contact), so the first
--   team email stamps it; re-sending never moves it. Entries cleared
--   without a team email stay NULL until Dispatch confirms them.
-- created_by: who typed a manual entry (job-triggered rows leave it NULL;
--   the job's own history says who moved it).
-- removed_*: a counted entry is never deleted, only struck out with who,
--   when and why, and left out of every figure. Unsent, unconfirmed
--   entries are still deleted outright, as before: they never counted.
--
-- Entries are matched to Job Separation lines by PO + PM code when read
-- (lib/dispatchLedger.ts), not stored, so a line entered or corrected
-- after the dispatch still picks it up.
-- ============================================================

ALTER TABLE pending_dispatch_notifications
  ADD COLUMN confirmed_at  TIMESTAMPTZ,
  ADD COLUMN created_by    TEXT,
  ADD COLUMN removed_at    TIMESTAMPTZ,
  ADD COLUMN removed_by    TEXT,
  ADD COLUMN remove_reason TEXT,
  ADD CONSTRAINT pending_dispatch_removed_has_reason
    CHECK (removed_at IS NULL OR (removed_by IS NOT NULL AND btrim(coalesce(remove_reason, '')) <> ''));

-- Every entry already team-emailed counts from the day of that email.
UPDATE pending_dispatch_notifications
   SET confirmed_at = internal_notified_at
 WHERE internal_notified_at IS NOT NULL;

-- Reports reads confirmed, live entries.
CREATE INDEX idx_pending_dispatch_notifications_confirmed
  ON pending_dispatch_notifications (confirmed_at)
  WHERE confirmed_at IS NOT NULL AND removed_at IS NULL;

-- Reports refetches when dispatch entries change (same counter as 075).
DROP TRIGGER IF EXISTS bump_data_version ON pending_dispatch_notifications;
CREATE TRIGGER bump_data_version AFTER INSERT OR UPDATE OR DELETE ON pending_dispatch_notifications
  FOR EACH STATEMENT EXECUTE FUNCTION bump_data_version();
INSERT INTO data_versions (name) VALUES ('pending_dispatch_notifications') ON CONFLICT DO NOTHING;
