-- ============================================================
-- 036_flatbed_dies_serial_no.sql
-- The team decided against status/damage tracking for flatbed dies (unlike
-- rotary dies, where it stays) — drop it and give flatbed dies a plain
-- auto-incrementing serial number (1, 2, 3, ...) instead, assigned by the
-- database on insert rather than typed in by hand.
-- ============================================================

ALTER TABLE flatbed_dies
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS damage_date,
  DROP COLUMN IF EXISTS damage_reason;

ALTER TABLE flatbed_dies
  ADD COLUMN serial_no INTEGER GENERATED ALWAYS AS IDENTITY;

ALTER TABLE flatbed_dies
  ADD CONSTRAINT flatbed_dies_serial_no_unique UNIQUE (serial_no);
