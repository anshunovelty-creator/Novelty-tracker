-- ============================================================
-- 079_note_edits.sql
-- Edit within 15 minutes: the author of an internal note can fix it for a
-- short while after posting (PATCH /api/notes/[id]), and the bubble then
-- says "edited". NULL = never edited. Additive; existing notes untouched.
-- ============================================================

ALTER TABLE stage_comments ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
