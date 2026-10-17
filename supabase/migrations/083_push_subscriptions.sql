-- ============================================================
-- 083_push_subscriptions.sql
-- One row per browser/device that has allowed notifications, so a new
-- internal note or chat message reaches people with the app closed
-- (src/lib/push.ts sends; public/sw.js shows it).
--
-- Keyed by the push endpoint: a shared PC that signs in as someone else
-- re-registers the same endpoint and the row moves to the new person.
-- Rows the push service reports gone (404/410) are deleted on send.
--
-- RLS on with no policies: only the API (service role) reads or writes.
-- ============================================================

CREATE TABLE push_subscriptions (
  endpoint    TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email  TEXT NOT NULL,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX push_subscriptions_user_email_idx ON push_subscriptions (user_email);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
