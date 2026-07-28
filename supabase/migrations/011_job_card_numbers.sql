-- ============================================================
-- 011_job_card_numbers.sql
-- Auto-assigned job card numbers: <mon><yy>-<seq>  e.g. jul26-1, jul26-102
--
-- Requested by the prepress team: every job needs a short, human-quotable
-- card number. The sequence restarts at 1 each calendar month.
--
-- Month boundary is evaluated in Asia/Kolkata, NOT UTC. A job added at
-- 00:30 IST on 1 Aug is 19:00 UTC on 31 Jul — using UTC would file it
-- under jul26 and the floor would read the wrong month off the card.
-- ============================================================


-- ── Column ────────────────────────────────────────────────────
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_card_number TEXT;


-- ============================================================
-- TABLE: job_card_counters
-- One row per period ('jul26'), holding the last sequence issued.
--
-- Why a counter table instead of MAX(seq)+1 over jobs (the pattern
-- used by trigger_set_print_run_number): that MAX+1 read is not
-- atomic. print_runs scopes its counter per job_id, so two concurrent
-- inserts colliding is vanishingly rare. This counter is global per
-- month — every job in the shop contends for it — so two clerks adding
-- jobs at the same moment would both read the same MAX and produce a
-- duplicate. The UPSERT below takes a row lock and increments in one
-- statement, so concurrent inserts serialise correctly.
-- ============================================================
CREATE TABLE IF NOT EXISTS job_card_counters (
  period    TEXT    PRIMARY KEY,          -- 'jul26'
  last_seq  INTEGER NOT NULL DEFAULT 0
);


-- ── Period key helper ─────────────────────────────────────────
-- IMMUTABLE is deliberately NOT claimed: the AT TIME ZONE conversion
-- depends on the timezone database, so this is STABLE only.
CREATE OR REPLACE FUNCTION job_card_period(ts TIMESTAMPTZ)
RETURNS TEXT AS $$
  SELECT lower(to_char(ts AT TIME ZONE 'Asia/Kolkata', 'MonYY'));
$$ LANGUAGE sql STABLE;


-- ── Assignment trigger ────────────────────────────────────────
CREATE OR REPLACE FUNCTION trigger_set_job_card_number()
RETURNS TRIGGER AS $$
DECLARE
  v_period TEXT;
  v_seq    INTEGER;
BEGIN
  -- An explicitly supplied number wins, so data imports and manual
  -- corrections can pin a specific card number without the trigger
  -- overwriting it.
  IF NEW.job_card_number IS NOT NULL AND btrim(NEW.job_card_number) <> '' THEN
    RETURN NEW;
  END IF;

  -- Column DEFAULTs are applied before BEFORE-INSERT triggers fire, so
  -- created_at is already populated here. COALESCE guards the case
  -- where a caller passes created_at => NULL explicitly.
  v_period := job_card_period(COALESCE(NEW.created_at, NOW()));

  INSERT INTO job_card_counters (period, last_seq)
       VALUES (v_period, 1)
  ON CONFLICT (period)
  DO UPDATE SET last_seq = job_card_counters.last_seq + 1
    RETURNING last_seq INTO v_seq;

  NEW.job_card_number := v_period || '-' || v_seq;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_job_card_number ON jobs;
CREATE TRIGGER set_job_card_number
  BEFORE INSERT ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_job_card_number();


-- ============================================================
-- BACKFILL — every pre-existing job, grouped by creation month,
-- oldest first. id is the tiebreaker so the ordering is total and
-- the result is deterministic if this is ever re-run on a clone.
-- ============================================================
WITH numbered AS (
  SELECT
    id,
    job_card_period(created_at) AS period,
    ROW_NUMBER() OVER (
      PARTITION BY job_card_period(created_at)
      ORDER BY created_at, id
    ) AS seq
  FROM jobs
  WHERE job_card_number IS NULL
)
UPDATE jobs j
   SET job_card_number = n.period || '-' || n.seq
  FROM numbered n
 WHERE j.id = n.id;


-- ── Seed the counters from what the backfill just wrote ───────
-- Without this the next insert would restart at 1 and collide with a
-- backfilled row. GREATEST keeps the higher value if a counter row
-- somehow already exists.
INSERT INTO job_card_counters (period, last_seq)
SELECT
  split_part(job_card_number, '-', 1),
  MAX(split_part(job_card_number, '-', 2)::INTEGER)
FROM jobs
WHERE job_card_number IS NOT NULL
  AND job_card_number ~ '^[a-z]{3}[0-9]{2}-[0-9]+$'
GROUP BY 1
ON CONFLICT (period)
DO UPDATE SET last_seq = GREATEST(job_card_counters.last_seq, EXCLUDED.last_seq);


-- ── Integrity ─────────────────────────────────────────────────
-- Safety net: if the counter is ever bypassed or hand-edited, a
-- duplicate card number fails loudly at write time instead of
-- silently putting two jobs on the same card on the floor.
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_job_card_number
  ON jobs (job_card_number);

-- Lookup by card number is a primary prepress workflow (someone reads
-- a number off a printed card and searches for it).
CREATE INDEX IF NOT EXISTS idx_jobs_job_card_number_lower
  ON jobs (lower(job_card_number));
