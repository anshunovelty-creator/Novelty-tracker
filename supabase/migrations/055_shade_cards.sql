-- ============================================================
-- NOVELTY LABELS JOB TRACKING SYSTEM
-- Migration 055: shade_cards + shade_card_status_history
-- ============================================================
-- Folds in the standalone Shade Card Tracker, which ran as its own Next app
-- against its own Supabase project (github.com/mrpal5a/novelty-shade-card-tracker).
-- The pipeline already has "Shade Card Sent" and "Shade Card Approved" stages
-- owned by QC (see 039) — this brings the actual shade card records alongside
-- them instead of leaving them in a second system nothing links to.
--
-- Two deliberate departures from the source schema:
--
--  1. No `profiles` table. The source app carried its own profiles/role
--     column and an is_admin() SECURITY DEFINER helper. This app already has
--     a department permission system (039/040), and the source's four roles
--     map onto it exactly:
--         viewer   -> Viewer   (is_read_only)
--         prepress -> Prepress
--         qc       -> QC
--         admin    -> Admin    (is_super_admin)
--     So RLS here rides dept_has_permission()/dept_is_super_admin() like every
--     other table, and there is one permission model in the system, not two.
--
--  2. created_by / updated_by are NULL for every imported row. They were FKs
--     to auth.users in the *old* project, and those UUIDs do not exist here.
--     The *_name text columns carry the attribution instead — they are
--     populated on all 3,014 imported rows ("Legacy import" on 2,847 of them).
--     Cards created from here on get a real FK.
-- ============================================================


-- ============================================================
-- shade_cards
-- ============================================================
-- A revision supersedes its predecessor rather than overwriting it: the new
-- row carries version+1 and supersedes_id, and the old row drops is_current.
-- Barely exercised in the imported data (2 superseded rows, max version 2),
-- but it is how the approval trail stays intact, so it comes across as-is.
CREATE TABLE shade_cards (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  party               TEXT NOT NULL,
  product_name        TEXT NOT NULL,

  -- The PM number. Present on 2,452 of 3,014 imported rows, and the primary
  -- key for cross-referencing a card to a job. Not unique: the same PM code
  -- legitimately appears on a reissued card, and 2 numbers are already
  -- duplicated in the imported data.
  pm_code             TEXT,
  shade_card_number   TEXT,
  docket_number       TEXT,

  -- Rejected / Revision Requested / Expired were retired at QC's request and
  -- are no longer offered in the UI, but they stay legal here: historical rows
  -- and status-history entries may still carry them, and a CHECK that rejected
  -- them would fail the import.
  status              TEXT NOT NULL DEFAULT 'Pending Approval'
                        CHECK (status IN ('Pending Approval', 'Approved', 'Rejected',
                                          'Revision Requested', 'Expired')),

  -- Whether the physical card has actually been made. One-way in practice:
  -- "Already Made" never goes back to "Pending" (enforced in the API layer,
  -- same as the source app enforced it in its server action).
  making_status       TEXT NOT NULL DEFAULT 'Pending'
                        CHECK (making_status IN ('Pending', 'Already Made')),

  prepared_date       DATE,
  approval_date       DATE,
  sent_to_party_date  DATE,
  received_back_date  DATE,

  -- A QNAP share path typed in for reference. Never fetched or resolved by
  -- the app — it is a note that happens to look like a path.
  qnap_path           TEXT,
  notes               TEXT,

  version             INTEGER NOT NULL DEFAULT 1,
  is_current          BOOLEAN NOT NULL DEFAULT TRUE,
  supersedes_id       UUID REFERENCES shade_cards(id) ON DELETE SET NULL,

  -- SET NULL rather than CASCADE: a departing employee must not delete the
  -- shade cards they entered. The *_name snapshot below outlives the account.
  created_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name     TEXT,
  updated_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by_name     TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Every list view filters is_current first, then sorts by updated_at.
CREATE INDEX idx_shade_cards_is_current  ON shade_cards (is_current);
CREATE INDEX idx_shade_cards_status      ON shade_cards (status);
CREATE INDEX idx_shade_cards_making      ON shade_cards (making_status);
CREATE INDEX idx_shade_cards_updated_at  ON shade_cards (updated_at DESC);
CREATE INDEX idx_shade_cards_prepared    ON shade_cards (prepared_date);
CREATE INDEX idx_shade_cards_supersedes  ON shade_cards (supersedes_id);

-- The job cross-reference matches on pm_code first and falls back to
-- party + product_name, so both need to be cheap to look up. LOWER() because
-- the match is case-insensitive on both sides.
CREATE INDEX idx_shade_cards_pm_code     ON shade_cards (LOWER(pm_code));
CREATE INDEX idx_shade_cards_party_prod  ON shade_cards (LOWER(party), LOWER(product_name));

CREATE TRIGGER shade_cards_set_updated_at
  BEFORE UPDATE ON shade_cards
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- ============================================================
-- shade_card_status_history
-- ============================================================
-- Append-only audit trail, written by trigger rather than by the API so a
-- direct SQL edit is recorded too. 5,975 rows come across in the import.
CREATE TABLE shade_card_status_history (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- CASCADE here, unlike the SET NULL above: a history row has no meaning
  -- once its card is gone, and deleting a card is already super-admin-only.
  shade_card_id    UUID NOT NULL REFERENCES shade_cards(id) ON DELETE CASCADE,

  old_status       TEXT,          -- NULL on the row recording creation
  new_status       TEXT NOT NULL,
  changed_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_by_name  TEXT,
  changed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sc_history_card_id    ON shade_card_status_history (shade_card_id, changed_at DESC);
CREATE INDEX idx_sc_history_changed_at ON shade_card_status_history (changed_at DESC);


-- Record creation and every subsequent status change. Fires on INSERT so a
-- card's trail starts at its first status, and on UPDATE only when status
-- actually moved — a field edit or a making_status flip writes nothing.
CREATE OR REPLACE FUNCTION log_shade_card_status() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO shade_card_status_history
      (shade_card_id, old_status, new_status, changed_by, changed_by_name)
    VALUES (NEW.id, NULL, NEW.status, NEW.created_by, NEW.created_by_name);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO shade_card_status_history
      (shade_card_id, old_status, new_status, changed_by, changed_by_name)
    VALUES (NEW.id, OLD.status, NEW.status, NEW.updated_by, NEW.updated_by_name);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER shade_cards_log_status
  AFTER INSERT OR UPDATE ON shade_cards
  FOR EACH ROW EXECUTE FUNCTION log_shade_card_status();


-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE shade_cards               ENABLE ROW LEVEL SECURITY;
ALTER TABLE shade_card_status_history ENABLE ROW LEVEL SECURITY;

-- Readable by every department. Anyone about to print needs to know whether a
-- shade card exists and whether the party signed it off — same reasoning as
-- plates and dies.
CREATE POLICY "shade_cards_select_authenticated"
  ON shade_cards FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "shade_cards_insert_permitted"
  ON shade_cards FOR INSERT
  TO authenticated
  WITH CHECK (dept_has_permission('shade_card_manage'));

CREATE POLICY "shade_cards_update_permitted"
  ON shade_cards FOR UPDATE
  TO authenticated
  USING (dept_has_permission('shade_card_manage'))
  WITH CHECK (dept_has_permission('shade_card_manage'));

-- Deletion stays with the super-admin department, matching the source app,
-- where delete was admin-only while Prepress and QC could do everything else.
CREATE POLICY "shade_cards_delete_super_admin"
  ON shade_cards FOR DELETE
  TO authenticated
  USING (dept_is_super_admin());

-- History is readable by all and writable by no one: every row arrives
-- through the trigger, which runs as its definer and is not subject to these
-- policies. No INSERT/UPDATE/DELETE policy exists, so the audit trail cannot
-- be rewritten from the client even by an admin.
CREATE POLICY "sc_history_select_authenticated"
  ON shade_card_status_history FOR SELECT
  TO authenticated
  USING (TRUE);


-- ============================================================
-- Seed: who may manage shade cards
-- ============================================================
-- Prepress and QC, mirroring the source app where both roles shared the card
-- management rights. Admin is is_super_admin and short-circuits in
-- dept_has_permission(), so it needs no row. Viewer is is_read_only and is
-- additionally blocked by the mutating-method check in src/middleware.ts.
INSERT INTO department_feature_permissions (department_id, feature_key)
SELECT id, 'shade_card_manage' FROM departments WHERE key IN ('Prepress', 'QC')
ON CONFLICT DO NOTHING;


COMMENT ON TABLE shade_cards IS
  'Shade cards sent to parties for colour approval. Migrated from the standalone Shade Card Tracker (Sept 2026); see migration 055 for the two schema departures.';
COMMENT ON COLUMN shade_cards.qnap_path IS
  'Reference-only QNAP share path typed in by the user. Never resolved or fetched by the app.';
COMMENT ON COLUMN shade_cards.created_by IS
  'NULL on all rows imported from the old project — those auth.users ids do not exist here. Read created_by_name for imported attribution.';
COMMENT ON COLUMN shade_cards.is_current IS
  'FALSE once a later revision supersedes this row. Every list view filters on TRUE.';
