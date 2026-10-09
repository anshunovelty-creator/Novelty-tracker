-- ============================================================
-- 078_note_replies.sql
-- WhatsApp-style replies in the Notes drawer: a note can answer another
-- note, and the feed shows the quoted original above the reply.
--
-- Nullable and additive: existing notes and writers are untouched. Notes are
-- never deleted (append-only, 004), so SET NULL only matters if a job is
-- deleted and its notes cascade away — the reply then simply loses its quote.
-- ============================================================

ALTER TABLE stage_comments
  ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES stage_comments(id) ON DELETE SET NULL;
