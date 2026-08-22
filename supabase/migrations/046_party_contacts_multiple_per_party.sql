-- ============================================================
-- NOVELTY LABELS JOB TRACKING SYSTEM
-- Migration 046: allow multiple contacts per party
-- ============================================================
-- party_contacts was one row per party (party TEXT UNIQUE), so a dispatch
-- or status email could only ever reach one person. Some parties (e.g.
-- UPL) want several people cc'd on every dispatch. Dropping the
-- uniqueness lets Admin add as many contact rows per party as needed —
-- every email address on file for that party gets the email; the
-- individual-name greeting ("Dear X,") is only used when a party has
-- exactly one contact, falling back to the party/company name otherwise.
-- ============================================================

ALTER TABLE party_contacts
  DROP CONSTRAINT IF EXISTS party_contacts_party_key;
