-- ============================================================
-- 023_parties.sql
-- Master list of party (client) names for the Job Separation worksheet.
-- Prepress/Admin add to this list; the Party field on a job separation
-- row then picks from it instead of being hand-typed, so "ARYSTA",
-- "Arysta" and "arysta " never end up as three different parties in
-- the data.
--
-- The Party column on job_separations stays free TEXT, unchanged — this
-- table only feeds its typeahead. Deleting a name here never touches a
-- row already saved with it.
-- ============================================================

CREATE TABLE IF NOT EXISTS parties (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Case-insensitive, trim-insensitive: the same guard dies.serial_no and
-- plates.plate_id use for hand-typed values that must not fork into
-- near-duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_parties_name_lower
  ON parties (lower(btrim(name)));

-- The typeahead's hot path: prefix search, alphabetical.
CREATE INDEX IF NOT EXISTS idx_parties_name
  ON parties (name);

-- Seed from every distinct party already on the worksheet, so the list
-- isn't empty the day this ships. DISTINCT ON collapses case/whitespace
-- variants of the same party down to one row (picking whichever spelling
-- sorts first); ON CONFLICT is a second backstop for the same collision.
INSERT INTO parties (name)
SELECT DISTINCT ON (lower(btrim(party))) btrim(party)
FROM job_separations
WHERE party IS NOT NULL AND btrim(party) <> ''
ORDER BY lower(btrim(party)), party
ON CONFLICT (lower(btrim(name))) DO NOTHING;


-- ── Row Level Security ────────────────────────────────────────
-- Mirrors dies/plates/job_separations: authenticated staff read (the
-- picker needs it everywhere Job Separation is open); writes go through
-- the service-role admin client in the API layer, where the
-- Prepress/Admin gate lives.
ALTER TABLE parties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "parties_select_authenticated" ON parties;
CREATE POLICY "parties_select_authenticated"
  ON parties FOR SELECT
  TO authenticated
  USING (true);
