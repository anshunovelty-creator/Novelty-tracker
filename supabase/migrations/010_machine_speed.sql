-- 010_machine_speed.sql
-- ============================================================
-- Machine throughput, used to work out estimated finish times instead of
-- Production typing them in for every job.
--   labels_per_hour: how many labels this machine prints in an hour at a
--     normal run rate. Nullable — a machine with no figure simply gets no
--     automatic estimate, and anything typed by hand always wins.
-- Additive and reversible: existing rows keep NULL, and every current
-- SELECT * against machines continues to work unchanged.
-- ============================================================

ALTER TABLE machines
  ADD COLUMN IF NOT EXISTS labels_per_hour INTEGER
    CHECK (labels_per_hour IS NULL OR labels_per_hour > 0);

COMMENT ON COLUMN machines.labels_per_hour IS
  'Normal run rate in labels/hour. NULL = no automatic finish estimate.';
