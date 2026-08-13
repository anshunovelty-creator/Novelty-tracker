-- ============================================================
-- 033_job_separations_job_link.sql
-- Lets Prepress/Admin add a Job straight from a Job Separation row
-- (prefilled from party/po_no/po_date/pm_code/quantity/material_name),
-- instead of retyping the same PO line into the Add Job form.
--
-- linked_job_id marks a row as "already turned into a Job" so the button
-- can become "View Job" instead of allowing a second Job to be created
-- from the same row. linked_job_card_number is denormalized alongside it
-- purely so the worksheet can display "JUN26-4" without a join.
-- ============================================================

ALTER TABLE job_separations
  ADD COLUMN IF NOT EXISTS linked_job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linked_job_card_number TEXT;
