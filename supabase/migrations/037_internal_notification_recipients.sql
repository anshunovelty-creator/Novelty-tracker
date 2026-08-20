-- ============================================================
-- NOVELTY LABELS JOB TRACKING SYSTEM
-- Migration 037: internal_notification_recipients table
-- ============================================================
-- Internal staff/team email addresses that get a copy of the dispatch
-- notification (same email as the client receives) whenever a job goes
-- to Partial Dispatch or Dispatched. Managed from /admin/notifications,
-- Admin only — mirrors the party_contacts / team RLS pattern.
-- ============================================================

CREATE TABLE internal_notification_recipients (
  id         UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  email      TEXT    NOT NULL UNIQUE,
  label      TEXT,                     -- optional, e.g. "Accounts" or a person's name
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE internal_notification_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can read internal notification recipients"
  ON internal_notification_recipients FOR SELECT
  TO authenticated
  USING (current_dept() = 'Admin');

CREATE POLICY "Admin can insert internal notification recipients"
  ON internal_notification_recipients FOR INSERT
  TO authenticated
  WITH CHECK (current_dept() = 'Admin');

CREATE POLICY "Admin can delete internal notification recipients"
  ON internal_notification_recipients FOR DELETE
  TO authenticated
  USING (current_dept() = 'Admin');
