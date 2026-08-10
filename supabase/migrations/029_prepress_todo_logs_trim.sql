-- ============================================================
-- 029_prepress_todo_logs_trim.sql
-- Caps prepress_todo_logs (028) at its 1000 most recent rows — wider
-- than the 150 the panel's History view displays on screen, so the
-- team has a buffer of older rows they can still pull via CSV export
-- (see /api/prepress-todos/logs/export) before this trigger deletes
-- them for good. Every task produces at least 2-3 log rows over its
-- life (created, completed/reopened, deleted), so an active team would
-- otherwise grow this table without bound. A trigger keeps the cap
-- self-maintaining regardless of which route does the inserting, and a
-- one-time cleanup below trims whatever already exceeds it.
-- ============================================================

CREATE OR REPLACE FUNCTION trim_prepress_todo_logs()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM prepress_todo_logs
  WHERE id NOT IN (
    SELECT id FROM prepress_todo_logs
    ORDER BY created_at DESC
    LIMIT 1000
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_trim_prepress_todo_logs ON prepress_todo_logs;
CREATE TRIGGER trg_trim_prepress_todo_logs
  AFTER INSERT ON prepress_todo_logs
  FOR EACH STATEMENT
  EXECUTE FUNCTION trim_prepress_todo_logs();

-- One-time cleanup for rows already past the cap.
DELETE FROM prepress_todo_logs
WHERE id NOT IN (
  SELECT id FROM prepress_todo_logs
  ORDER BY created_at DESC
  LIMIT 1000
);
