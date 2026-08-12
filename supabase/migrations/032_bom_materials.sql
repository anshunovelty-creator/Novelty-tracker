-- ============================================================
-- 032_bom_materials.sql
-- The material catalogue behind the Bill of Material typeahead.
--
-- Why this exists: within a day of the feature going live the same paper
-- had been entered as "CHROMO 80GSM" and "Chromo Paper 80gsm". Free text
-- fragments immediately, and once it does, "what did we spend on chromo
-- this year" can never be answered. This table is the one spelling.
--
-- It fills itself: POST /api/bom-requests adds any material name it has
-- not seen before, so the catalogue grows out of real usage instead of
-- needing to be curated up front. name_key is the case- and
-- whitespace-insensitive identity, so "CHROMO 80GSM" and "chromo 80gsm"
-- collapse to one row rather than becoming two.
--
-- Same visibility rule as the rest of BOM: Production + Admin only.
-- ============================================================

CREATE TABLE IF NOT EXISTS bom_materials (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What gets shown and written onto new request lines: the first spelling
  -- that entered the catalogue wins, and later near-matches fold into it.
  name          TEXT NOT NULL,

  -- Identity for deduplication. Generated so it can never drift from name.
  name_key      TEXT GENERATED ALWAYS AS (lower(btrim(name))) STORED,

  -- Remembered from the last request that used this material, so picking it
  -- fills the rest of the line in. Nullable: plenty of materials are just
  -- a name.
  specification TEXT,
  default_size  TEXT,
  default_unit  TEXT,

  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT bom_materials_name_key_unique UNIQUE (name_key)
);

-- The typeahead's query: prefix and substring match on the display name.
CREATE INDEX IF NOT EXISTS idx_bom_materials_name_key
  ON bom_materials (name_key);

-- ── updated_at maintenance ────────────────────────────────────
CREATE OR REPLACE FUNCTION trigger_touch_bom_materials()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS touch_bom_materials ON bom_materials;
CREATE TRIGGER touch_bom_materials
  BEFORE UPDATE ON bom_materials
  FOR EACH ROW
  EXECUTE FUNCTION trigger_touch_bom_materials();

-- ── Seed from whatever has already been requested ─────────────
-- Idempotent: re-running the migration adds nothing new. DISTINCT ON picks
-- the most recent spelling of each material and carries its spec/size/unit
-- across as the defaults.
INSERT INTO bom_materials (name, specification, default_size, default_unit, created_by)
SELECT DISTINCT ON (lower(btrim(material)))
       btrim(material), specification, size, unit, 'seed:032'
  FROM bom_request_items
 WHERE btrim(COALESCE(material, '')) <> ''
 ORDER BY lower(btrim(material)), created_at DESC
ON CONFLICT (name_key) DO NOTHING;

-- ── Row Level Security ────────────────────────────────────────
ALTER TABLE bom_materials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bom_materials_select_prod_admin" ON bom_materials;
CREATE POLICY "bom_materials_select_prod_admin"
  ON bom_materials FOR SELECT
  TO authenticated
  USING ((auth.jwt() -> 'user_metadata' ->> 'department') IN ('Admin', 'Production'));
