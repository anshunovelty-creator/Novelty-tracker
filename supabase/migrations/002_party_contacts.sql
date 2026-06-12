-- ============================================================
-- NOVELTY LABELS JOB TRACKING SYSTEM
-- Migration 002: party_contacts table
-- Run AFTER 001_initial_schema.sql
-- ============================================================
-- Stores one contact record per party (client company).
-- Keyed on `party` TEXT to match jobs.party — intentionally no FK
-- so contacts can be entered before any job exists.
--
-- Column naming note:
--   `contact_name` is the person's name used in email/WhatsApp greetings.
--   The notification routes query this column by name:
--     email/route.ts    → SELECT email, contact_name
--     whatsapp/route.ts → SELECT whatsapp, contact_name
--   Do NOT rename to party_name — that would silently break both routes.
-- ============================================================

CREATE TABLE party_contacts (
  id            UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  party         TEXT    NOT NULL UNIQUE,  -- exact match to jobs.party (case-sensitive)
  contact_name  TEXT,                     -- person's name for greeting: "Dear Rajesh Singh"
  email         TEXT,                     -- used by Resend for email notifications
  whatsapp      TEXT,                     -- WATI format: country code + number, no + or spaces
                                          -- e.g. 919876543210 for +91 98765 43210
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Primary lookup pattern: WHERE party = $1
CREATE INDEX idx_party_contacts_party ON party_contacts (party);

-- Auto-update updated_at (reuses the function created in migration 001)
CREATE TRIGGER set_party_contacts_updated_at
  BEFORE UPDATE ON party_contacts
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- ============================================================
-- ROW LEVEL SECURITY
-- Pattern matches 001_initial_schema.sql:
--   SELECT  → all authenticated users (notification routes run server-side)
--   INSERT / UPDATE → Admin only (contact management is admin responsibility)
--   DELETE  → Admin only
-- current_dept() is defined in migration 001 — already live in DB.
-- ============================================================

ALTER TABLE party_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read party contacts"
  ON party_contacts FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "Admin can insert party contacts"
  ON party_contacts FOR INSERT
  TO authenticated
  WITH CHECK (current_dept() = 'Admin');

CREATE POLICY "Admin can update party contacts"
  ON party_contacts FOR UPDATE
  TO authenticated
  USING (current_dept() = 'Admin');

CREATE POLICY "Admin can delete party contacts"
  ON party_contacts FOR DELETE
  TO authenticated
  USING (current_dept() = 'Admin');


-- ============================================================
-- SEED DATA EXAMPLE
-- Uncomment and edit before running, or add rows via the Admin UI later.
-- ============================================================
-- INSERT INTO party_contacts (party, contact_name, email, whatsapp) VALUES
--   ('UPL Limited',    'Ravi Sharma',  'orders@upl.com',          '919876543210'),
--   ('Rajat Pharma',   'Anita Patel',  'purchase@rajatpharma.in', '919988776655');
