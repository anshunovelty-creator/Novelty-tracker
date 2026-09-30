-- ============================================================
-- 069_track_po_normalized.sql
-- Forgiving PO / PM code lookup for the /track portal.
--
-- /track used to match any 2+ characters of a PO (substring), which let
-- anyone list jobs by guessing "00". It now needs the whole PO, but a
-- client may type "ABC-123/25" as "abc 123 25" or "ABC12325". These
-- generated columns hold the PO and PM code lowercased with everything
-- except letters and digits stripped; /track normalises the typed term the
-- same way and compares with plain equality — no pattern, so no
-- enumeration — and still requires the Company Name to match.
--
-- DEPLOY ORDER: apply this BEFORE deploying the /track code that reads
-- po_norm / pm_norm (it's purely additive, safe with the old code).
-- ============================================================

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS po_norm text
    GENERATED ALWAYS AS (lower(regexp_replace(po_number, '[^A-Za-z0-9]', '', 'g'))) STORED,
  ADD COLUMN IF NOT EXISTS pm_norm text
    GENERATED ALWAYS AS (lower(regexp_replace(coalesce(pm_code, ''), '[^A-Za-z0-9]', '', 'g'))) STORED;

CREATE INDEX IF NOT EXISTS idx_jobs_po_norm ON public.jobs (po_norm);
CREATE INDEX IF NOT EXISTS idx_jobs_pm_norm ON public.jobs (pm_norm) WHERE pm_norm <> '';

COMMENT ON COLUMN public.jobs.po_norm IS
  'po_number lowercased, letters and digits only. /track lookup key (069).';
COMMENT ON COLUMN public.jobs.pm_norm IS
  'pm_code lowercased, letters and digits only ('''' when no PM code). /track lookup key (069).';
