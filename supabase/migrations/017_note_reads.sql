-- ============================================================
-- 017_note_reads.sql
-- Per-message read state for the global Notes feed (016_note_feed).
--
-- The feed previously tracked read/unread with a single "last seen"
-- timestamp per user, kept in browser localStorage. That could only
-- mark everything seen at once. This adds a real per-note, per-user
-- read receipt so the team can mark individual notes as read and see
-- an accurate remaining-unread count that follows them across devices.
-- ============================================================

CREATE TABLE note_reads (
  note_id    UUID NOT NULL REFERENCES stage_comments(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  read_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (note_id, user_email)
);

ALTER TABLE note_reads ENABLE ROW LEVEL SECURITY;

-- A user may only see and record their own read state — never another
-- account's. Writes go through the admin client in the API route (same
-- convention as stage_comments inserts), but the policy still documents
-- and enforces the intended shape in case that ever changes.
CREATE POLICY "Users can read their own note-read state"
  ON note_reads FOR SELECT
  TO authenticated
  USING (user_email = (auth.jwt() ->> 'email'));

CREATE POLICY "Users can mark notes read for themselves"
  ON note_reads FOR INSERT
  TO authenticated
  WITH CHECK (user_email = (auth.jwt() ->> 'email'));
