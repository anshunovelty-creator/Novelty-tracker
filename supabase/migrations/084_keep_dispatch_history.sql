-- ============================================================
-- 084_keep_dispatch_history.sql
-- Stop deleting sent dispatch notifications.
--
-- 013 capped the table at the 100 most-recently-sent rows. Those rows are
-- the only record of what the dispatch team actually sent out (PO, PM
-- code, qty, date), and reports are about to be built on them, so every
-- party email was throwing away the oldest dispatches. Sent rows are
-- never read by the app (every query filters notified_at IS NULL), so
-- keeping them changes nothing on screen.
-- ============================================================

DROP TRIGGER IF EXISTS trim_dispatch_notification_history_trigger ON pending_dispatch_notifications;
DROP FUNCTION IF EXISTS trim_dispatch_notification_history();
