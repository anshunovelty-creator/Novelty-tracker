-- ============================================================
-- 049_flatbed_dies_repeat_length.sql
-- Adds Repeat Length to flatbed_dies — the repeat distance of the die's
-- pattern around/along the sheet, alongside its length/width. Free text
-- like the other size fields (the sheet mixes units), and left nullable
-- since existing rows predate the field.
-- ============================================================

ALTER TABLE flatbed_dies
  ADD COLUMN IF NOT EXISTS repeat_length TEXT;
