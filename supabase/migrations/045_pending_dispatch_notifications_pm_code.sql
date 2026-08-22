-- ============================================================
-- NOVELTY LABELS JOB TRACKING SYSTEM
-- Migration 045: PM code on dispatch notification entries
-- ============================================================
-- The dispatch email needs to show each item's PM (printing/material)
-- code, same as the old Google Sheets dispatch script did. Regular
-- job-triggered entries get it from jobs.pm_code (see the status route);
-- manual/custom entries can have it typed in directly.
-- ============================================================

ALTER TABLE pending_dispatch_notifications
  ADD COLUMN pm_code TEXT;
