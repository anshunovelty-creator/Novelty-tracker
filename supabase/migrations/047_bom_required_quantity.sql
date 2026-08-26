-- ============================================================
-- 047_bom_required_quantity.sql
-- Separates what the metre calculator says a job needs from what was
-- actually requested. They're usually the same number, but Production can
-- ask for more than the formula's result (a reprint buffer, a die change)
-- with a remark explaining why — and the owner deciding the line needs to
-- see both numbers side by side, not just the one that was typed in.
--
-- `quantity` keeps its existing meaning: what was requested. This adds
-- `required_quantity`: what the calculator computed before any extra was
-- added on top. Null on rows raised before this migration, and on any line
-- where quantity was never run through the calculator — the UI falls back
-- to showing just "Requested" for those, same as before this column existed.
-- ============================================================

ALTER TABLE bom_request_items
  ADD COLUMN IF NOT EXISTS required_quantity NUMERIC(12,2);
