-- ============================================================
-- NOVELTY LABELS JOB TRACKING SYSTEM
-- Migration 002: party_contacts table
-- Run AFTER 001_initial_schema.sql
-- ============================================================

CREATE TABLE party_contacts (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  party          TEXT NOT NULL UNIQUE,  -- must match jobs.party exactly
  email          TEXT,
  whatsapp       TEXT,                  -- phone number with country code, no +, no spaces
  contact_name   TEXT,                  -- optional: person's name for greeting
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_party_contacts_party ON party_contacts (party);

CREATE TRIGGER set_party_contacts_updated_at
  BEFORE UPDATE ON party_contacts
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

ALTER TABLE party_contacts ENABLE ROW LEVEL SECURITY;

-- Only authenticated staff can read/write contacts
CREATE POLICY "Authenticated users can read party contacts"
  ON party_contacts FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "Admin can insert party contacts"
  ON party_contacts FOR INSERT TO authenticated
  WITH CHECK (current_dept() IN ('Admin', 'Dispatch'));

CREATE POLICY "Admin can update party contacts"
  ON party_contacts FOR UPDATE TO authenticated
  USING (current_dept() IN ('Admin', 'Dispatch'));

-- ── Seed data example (edit to match your actual clients) ──
-- INSERT INTO party_contacts (party, email, whatsapp, contact_name) VALUES
--   ('UPL Limited',    'orders@upl.com',         '919876543210', 'Ravi Sharma'),
--   ('Rajat Pharma',   'purchase@rajatpharma.in', '919988776655', 'Anita Patel');
