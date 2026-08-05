-- ============================================================
-- 021_die_status.sql
-- Where a die is and what state it is in.
--
-- 'IN USE'  — the default. Nothing wrong with it, it just sits on the rack.
-- 'EXTRA'   — a spare beyond what's mounted, worth knowing about but not
--             the one anyone reaches for first.
-- 'DAMAGE'  — taken out of rotation. Damage date and reason are only
--             meaningful for this status, so they travel with it: set
--             together, cleared together, enforced by the API rather than
--             a CHECK constraint (the same posture used for jobs'
--             printing_method/printing_unit derivation).
-- ============================================================

ALTER TABLE dies
  ADD COLUMN IF NOT EXISTS location      TEXT,
  ADD COLUMN IF NOT EXISTS status        TEXT NOT NULL DEFAULT 'IN USE'
                             CHECK (status IN ('IN USE', 'EXTRA', 'DAMAGE')),
  ADD COLUMN IF NOT EXISTS damage_date   DATE,
  ADD COLUMN IF NOT EXISTS damage_reason TEXT;
