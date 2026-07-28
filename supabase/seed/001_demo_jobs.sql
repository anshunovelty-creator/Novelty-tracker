-- ============================================================
-- DEMO DATA — 50 jobs spread across all 15 pipeline stages
-- For presentations / training. NOT part of the schema migrations.
--
-- HOW TO RUN:  Supabase Dashboard → SQL Editor → New Query → paste → Run
-- HOW TO UNDO: run supabase/seed/002_demo_cleanup.sql
--
-- SAFETY
--   • Every row's po_number starts with 'DEMO-', so demo data is visible
--     as demo data on screen and is trivially separable from real POs.
--   • Wrapped in a transaction — if any statement fails, nothing is written.
--   • Re-running is safe: it deletes existing DEMO- rows first, so you can
--     reset between rehearsals. It never touches a non-DEMO row.
--
-- WHAT IT BUILDS
--   Not just 50 job rows. It also backfills job_stage_timestamps and
--   job_status_logs so the ✓ marks in the stage dropdown, the prerequisite
--   enforcement, the progress bars and the History panel all behave exactly
--   as they would for real jobs. The stamping rule mirrors
--   src/app/api/jobs/[id]/status/route.ts: reaching a stage stamps every
--   earlier VISIBLE stage too (Repeat jobs skip the 3 sample/shade stages).
-- ============================================================

BEGIN;

-- Reset any previous demo run (cascades to timestamps, logs, comments)
DELETE FROM jobs WHERE po_number LIKE 'DEMO-%';


-- ── The spec ────────────────────────────────────────────────
-- reached_stage: only for On Hold / PO Closed, which are not pipeline
-- stages. It says how far up the pipeline the job actually got before
-- being halted or closed.
CREATE TEMP TABLE demo_spec (
  po_number        TEXT,
  pm_code          TEXT,
  party            TEXT,
  job_name         TEXT,
  label_qty        INTEGER,
  job_type         TEXT,
  status           TEXT,
  reached_stage    TEXT,
  urgent           BOOLEAN,
  urgent_priority  INTEGER,
  notes            TEXT,
  dispatched_qty   INTEGER,
  halt_remark      TEXT,
  qc_remark        TEXT,
  is_closed        BOOLEAN,
  po_days_ago      INTEGER,
  delivery_in_days INTEGER
) ON COMMIT DROP;

INSERT INTO demo_spec VALUES
-- ── PO Received (4) ─────────────────────────────────────────
('DEMO-1001','PM-2041','Sunrise Foods Pvt Ltd','Mango Pickle 1kg Body Label',25000,'New','PO Received',NULL,false,NULL,NULL,0,NULL,NULL,false,2,21),
('DEMO-1002','PM-2042','Vedant Pharma','Paracetamol 650 Blister Foil Label',60000,'Repeat','PO Received',NULL,true,2,'Repeat order — artwork already on file',0,NULL,NULL,false,1,12),
('DEMO-1003','PM-2043','Green Valley Tea','Assam Gold 250g Pouch Label',18000,'New','PO Received',NULL,false,NULL,NULL,0,NULL,NULL,false,3,30),
('DEMO-1004','PM-2044','Metro Confectionery','Choco Bites Twist Wrap',120000,'New','PO Received',NULL,false,NULL,'Awaiting artwork files from client',0,NULL,NULL,false,1,26),
-- ── Artwork Received (3) ────────────────────────────────────
('DEMO-1005','PM-2045','Ganesh Masala Works','Garam Masala 100g Front Label',40000,'New','Artwork Received',NULL,false,NULL,NULL,0,NULL,NULL,false,5,18),
('DEMO-1006','PM-2046','Aroma Cosmetics','Rose Face Wash 150ml Wrap',22000,'Artwork Changed','Artwork Received',NULL,true,3,'Client revised logo placement after first proof',0,NULL,NULL,false,4,15),
('DEMO-1007','PM-2047','Shakti Agro Products','Organic Wheat Flour 5kg Bag Label',15000,'New','Artwork Received',NULL,false,NULL,NULL,0,NULL,NULL,false,6,24),
-- ── Prepress / Design Check (4) ─────────────────────────────
('DEMO-1008','PM-2048','Nutriwell Nutrition','Whey Protein 1kg Jar Label',12000,'New','Prepress / Design Check',NULL,false,NULL,NULL,0,NULL,NULL,false,7,16),
('DEMO-1009','PM-2049','Krishna Dairy','Full Cream Milk 500ml Sleeve',90000,'Repeat','Prepress / Design Check',NULL,true,1,'Rush — tied to weekly dairy cycle',0,NULL,NULL,false,6,5),
('DEMO-1010','PM-2050','Purex Chemicals','Floor Cleaner 1L Body Label',35000,'New','Prepress / Design Check',NULL,false,NULL,NULL,0,NULL,NULL,false,8,20),
('DEMO-1011','PM-2051','Deccan Spices','Sambar Powder 200g Front',28000,'Artwork Changed','Prepress / Design Check',NULL,false,NULL,NULL,0,NULL,NULL,false,5,19),
-- ── Sample Printing (3) — never Repeat, that type skips this ─
('DEMO-1012','PM-2052','Royal Bakers','Multigrain Bread Bag Tag',45000,'New','Sample Printing',NULL,false,NULL,NULL,0,NULL,NULL,false,9,14),
('DEMO-1013','PM-2053','Blue Ocean Beverages','Lemon Fizz 300ml Neck Label',75000,'New','Sample Printing',NULL,true,2,NULL,0,NULL,NULL,false,8,9),
('DEMO-1014','PM-2054','Ayush Herbals','Ashwagandha 60 Cap Bottle Label',20000,'Artwork Changed','Sample Printing',NULL,false,NULL,NULL,0,NULL,NULL,false,10,17),
-- ── Shade Card Sent (3) ─────────────────────────────────────
('DEMO-1015','PM-2055','Sunrise Foods Pvt Ltd','Tomato Ketchup 950g Body',32000,'New','Shade Card Sent',NULL,false,NULL,NULL,0,NULL,NULL,false,11,13),
('DEMO-1016','PM-2056','Aroma Cosmetics','Aloe Vera Gel 100ml Top Label',26000,'New','Shade Card Sent',NULL,true,3,'Shade card couriered — awaiting client sign-off',0,NULL,NULL,false,10,8),
('DEMO-1017','PM-2057','Silverline Packaging','Export Carton Barcode Label',55000,'Artwork Changed','Shade Card Sent',NULL,false,NULL,NULL,0,NULL,NULL,false,12,22),
-- ── Shade Card Approved (3) ─────────────────────────────────
('DEMO-1018','PM-2058','Vedant Pharma','Vitamin D3 Sachet Foil',80000,'New','Shade Card Approved',NULL,false,NULL,NULL,0,NULL,NULL,false,13,11),
('DEMO-1019','PM-2059','Green Valley Tea','Masala Chai 500g Gusset Label',24000,'New','Shade Card Approved',NULL,false,NULL,NULL,0,NULL,NULL,false,12,15),
('DEMO-1020','PM-2060','Metro Confectionery','Mint Candy Jar Wrap',65000,'Artwork Changed','Shade Card Approved',NULL,true,3,NULL,0,NULL,NULL,false,11,7),
-- ── In Printing (5) ─────────────────────────────────────────
('DEMO-1021','PM-2061','Krishna Dairy','Paneer 200g Top Label',50000,'Repeat','In Printing',NULL,false,NULL,NULL,0,NULL,NULL,false,14,6),
('DEMO-1022','PM-2062','Ganesh Masala Works','Chilli Powder 500g Front',38000,'New','In Printing',NULL,false,NULL,NULL,0,NULL,NULL,false,15,10),
('DEMO-1023','PM-2063','Blue Ocean Beverages','Orange Crush 1L Body Label',70000,'Repeat','In Printing',NULL,true,1,'Priority run — festive stocking deadline',0,NULL,NULL,false,12,3),
('DEMO-1024','PM-2064','Nutriwell Nutrition','Protein Bar Flow Wrap',95000,'New','In Printing',NULL,false,NULL,NULL,0,NULL,NULL,false,16,12),
('DEMO-1025','PM-2065','Purex Chemicals','Dish Wash Gel 500ml Label',42000,'Repeat','In Printing',NULL,false,NULL,NULL,0,NULL,NULL,false,13,9),
-- ── Slitting (4) ────────────────────────────────────────────
('DEMO-1026','PM-2066','Royal Bakers','Rusk 300g Pack Label',36000,'Repeat','Slitting',NULL,false,NULL,NULL,0,NULL,NULL,false,17,8),
('DEMO-1027','PM-2067','Shakti Agro Products','Basmati Rice 10kg Bag Label',14000,'New','Slitting',NULL,false,NULL,NULL,0,NULL,NULL,false,18,11),
('DEMO-1028','PM-2068','Ayush Herbals','Neem Tablets Strip Foil',48000,'Repeat','Slitting',NULL,true,2,NULL,0,NULL,NULL,false,15,4),
('DEMO-1029','PM-2069','Deccan Spices','Coriander Powder 1kg Front',30000,'New','Slitting',NULL,false,NULL,NULL,0,NULL,NULL,false,19,13),
-- ── Quality Check (4) ───────────────────────────────────────
('DEMO-1030','PM-2070','Sunrise Foods Pvt Ltd','Mixed Fruit Jam 500g Body',27000,'New','Quality Check',NULL,false,NULL,NULL,0,NULL,'Shade matched to approved card. Minor registration drift on lot 2 corrected on press.',false,20,7),
('DEMO-1031','PM-2071','Vedant Pharma','ORS Powder Sachet Foil',110000,'Repeat','Quality Check',NULL,true,1,'Pharma job — full QA trail required',0,NULL,'Barcode verified at grade A. Holding for pharma QA sign-off before packing.',false,16,2),
('DEMO-1032','PM-2072','Metro Confectionery','Toffee Twist Wrap Roll',85000,'Repeat','Quality Check',NULL,false,NULL,NULL,0,NULL,'Gloss level within tolerance. Passed.',false,18,9),
('DEMO-1033','PM-2073','Aroma Cosmetics','Shampoo 200ml Body Label',33000,'New','Quality Check',NULL,false,NULL,NULL,0,NULL,'Rejected 400 labels — ink smear on trailing edge. Reprint of shortfall approved.',false,21,6),
-- ── Packing (3) ─────────────────────────────────────────────
('DEMO-1034','PM-2074','Green Valley Tea','Green Tea 100 Bags Carton Label',21000,'Repeat','Packing',NULL,false,NULL,NULL,0,NULL,'Passed — no observations.',false,22,5),
('DEMO-1035','PM-2075','Krishna Dairy','Butter 100g Wrapper',60000,'Repeat','Packing',NULL,false,NULL,NULL,0,NULL,'Passed — shade consistent across all reels.',false,20,4),
('DEMO-1036','PM-2076','Silverline Packaging','Logistics Address Label',40000,'New','Packing',NULL,false,NULL,NULL,0,NULL,'Passed.',false,23,10),
-- ── Ready to Dispatch (4) ───────────────────────────────────
('DEMO-1037','PM-2077','Blue Ocean Beverages','Soda 750ml Body Label',52000,'Repeat','Ready to Dispatch',NULL,false,NULL,NULL,0,NULL,'Passed.',false,24,3),
('DEMO-1038','PM-2078','Ganesh Masala Works','Turmeric Powder 200g Front',44000,'New','Ready to Dispatch',NULL,false,NULL,NULL,0,NULL,'Passed.',false,25,5),
('DEMO-1039','PM-2079','Nutriwell Nutrition','Oats 1kg Pack Label',29000,'Repeat','Ready to Dispatch',NULL,true,2,'Vehicle booked — dispatch tomorrow morning',0,NULL,'Passed.',false,21,1),
('DEMO-1040','PM-2080','Royal Bakers','Cookies 400g Top Label',31000,'New','Ready to Dispatch',NULL,false,NULL,NULL,0,NULL,'Passed.',false,26,6),
-- ── Partial Dispatch (3) — dispatched_qty < label_qty ───────
('DEMO-1041','PM-2081','Vedant Pharma','Antacid Strip Foil',100000,'Repeat','Partial Dispatch',NULL,false,NULL,'Balance 40,000 to follow next week',60000,NULL,'Passed.',false,28,4),
('DEMO-1042','PM-2082','Deccan Spices','Black Pepper 100g Label',36000,'New','Partial Dispatch',NULL,false,NULL,NULL,20000,NULL,'Passed.',false,27,6),
('DEMO-1043','PM-2083','Purex Chemicals','Hand Wash 250ml Body',48000,'Repeat','Partial Dispatch',NULL,true,3,'Client asked for staggered delivery',30000,NULL,'Passed.',false,26,2),
-- ── Dispatched (3) — dispatched_qty = label_qty ─────────────
('DEMO-1044','PM-2084','Sunrise Foods Pvt Ltd','Honey 500g Jar Label',23000,'Repeat','Dispatched',NULL,false,NULL,NULL,23000,NULL,'Passed.',false,30,-2),
('DEMO-1045','PM-2085','Metro Confectionery','Lollipop Wrap Roll',90000,'New','Dispatched',NULL,false,NULL,NULL,90000,NULL,'Passed.',false,32,-1),
('DEMO-1046','PM-2086','Ayush Herbals','Tulsi Drops 30ml Bottle Label',17000,'Repeat','Dispatched',NULL,false,NULL,NULL,17000,NULL,'Passed.',false,29,0),
-- ── On Hold (2) — halted mid-pipeline ───────────────────────
('DEMO-1047','PM-2087','Shakti Agro Products','Mustard Oil 1L Body Label',34000,'New','On Hold','In Printing',true,3,NULL,0,'Client requested hold — packaging size under revision. Awaiting written confirmation before resuming.',NULL,false,18,8),
('DEMO-1048','PM-2088','Silverline Packaging','Fragile Handling Sticker',26000,'Repeat','On Hold','Prepress / Design Check',false,NULL,NULL,0,'On hold pending PO amendment for revised quantity.',NULL,false,15,16),
-- ── PO Closed (2) — terminal, Admin only ────────────────────
('DEMO-1049','PM-2089','Krishna Dairy','Curd 400g Lid Label',55000,'Repeat','PO Closed','Dispatched',false,NULL,NULL,55000,NULL,'Passed.',true,40,-8),
('DEMO-1050','PM-2090','Blue Ocean Beverages','Energy Drink 250ml Body',68000,'New','PO Closed','Dispatched',false,NULL,NULL,68000,NULL,'Passed.',true,45,-10);


-- ── 1. The job rows ─────────────────────────────────────────
-- remaining_qty is filled in by the sync_remaining_qty trigger.
-- updated_at is set at INSERT (the BEFORE UPDATE trigger would otherwise
-- force it to NOW() and every job would look touched this second).
INSERT INTO jobs (
  po_number, pm_code, party, job_name, label_qty,
  po_date, delivery_date, status, job_type,
  urgent, urgent_priority, notes, dispatched_qty,
  halt_remark, qc_remark, is_closed, created_at, updated_at
)
SELECT
  s.po_number, s.pm_code, s.party, s.job_name, s.label_qty,
  CURRENT_DATE - s.po_days_ago,
  CURRENT_DATE + s.delivery_in_days,
  s.status, s.job_type,
  s.urgent, s.urgent_priority, s.notes, s.dispatched_qty,
  s.halt_remark, s.qc_remark, s.is_closed,
  NOW() - (s.po_days_ago * INTERVAL '1 day'),
  NOW() - (s.po_days_ago * INTERVAL '1.5 hours')
FROM demo_spec s;


-- ── 2. Stage completion stamps ──────────────────────────────
-- Mirrors the API: reaching a stage means every earlier VISIBLE stage is
-- complete too. Repeat jobs skip Sample Printing / Shade Card Sent /
-- Shade Card Approved, so their history correctly shows those as N/A.
WITH pipe AS (
  SELECT
    ARRAY['PO Received','Artwork Received','Prepress / Design Check',
          'Sample Printing','Shade Card Sent','Shade Card Approved',
          'In Printing','Slitting','Quality Check','Packing',
          'Ready to Dispatch','Partial Dispatch','Dispatched']::TEXT[] AS full_p,
    ARRAY['PO Received','Artwork Received','Prepress / Design Check',
          'In Printing','Slitting','Quality Check','Packing',
          'Ready to Dispatch','Partial Dispatch','Dispatched']::TEXT[] AS repeat_p
),
sliced AS (
  SELECT
    j.id AS job_id,
    j.created_at,
    v.stages[1 : array_position(v.stages, COALESCE(s.reached_stage, s.status))] AS done
  FROM demo_spec s
  JOIN jobs j ON j.po_number = s.po_number
  CROSS JOIN pipe p
  CROSS JOIN LATERAL (
    SELECT CASE WHEN s.job_type = 'Repeat' THEN p.repeat_p ELSE p.full_p END
  ) AS v(stages)
  WHERE array_position(v.stages, COALESCE(s.reached_stage, s.status)) IS NOT NULL
)
INSERT INTO job_stage_timestamps (job_id, stage, completed_at)
SELECT
  sl.job_id,
  st.stage,
  -- Spread the completed stages evenly between job creation and now, so the
  -- History panel reads like a real progression instead of one bulk import.
  -- DOUBLE PRECISION, not NUMERIC: the interval * n operator is defined for
  -- float8, and relying on the implicit numeric cast is needless risk.
  sl.created_at
    + ((NOW() - sl.created_at)
       * (st.ord::DOUBLE PRECISION / (array_length(sl.done, 1) + 1)))
FROM sliced sl
CROSS JOIN LATERAL unnest(sl.done) WITH ORDINALITY AS st(stage, ord);

-- On Hold and PO Closed are not pipeline stages — the API stamps only
-- themselves, on top of whatever pipeline history the job already had.
INSERT INTO job_stage_timestamps (job_id, stage, completed_at)
SELECT j.id, s.status, NOW() - INTERVAL '6 hours'
FROM demo_spec s
JOIN jobs j ON j.po_number = s.po_number
WHERE s.status IN ('On Hold', 'PO Closed');


-- ── 3. The audit trail ──────────────────────────────────────
-- One log row per completed stage, attributed to the department that owns
-- that stage in DEPT_ALLOWED_STAGES (src/lib/constants/departments.ts).
INSERT INTO job_status_logs (job_id, status, changed_by_dept, changed_at, remark, qty_dispatched)
SELECT
  t.job_id,
  t.stage,
  CASE t.stage
    WHEN 'PO Received'             THEN 'Prepress'
    WHEN 'Artwork Received'        THEN 'Prepress'
    WHEN 'Prepress / Design Check' THEN 'Prepress'
    WHEN 'Sample Printing'         THEN 'QC'
    WHEN 'Shade Card Sent'         THEN 'QC'
    WHEN 'Shade Card Approved'     THEN 'QC'
    WHEN 'In Printing'             THEN 'Production'
    WHEN 'Slitting'                THEN 'Production'
    WHEN 'Quality Check'           THEN 'QC'
    WHEN 'Packing'                 THEN 'Dispatch'
    WHEN 'Ready to Dispatch'       THEN 'Dispatch'
    WHEN 'Partial Dispatch'        THEN 'Dispatch'
    WHEN 'Dispatched'              THEN 'Dispatch'
    WHEN 'On Hold'                 THEN 'Production'
    WHEN 'PO Closed'               THEN 'Admin'
  END,
  t.completed_at,
  CASE
    WHEN t.stage = 'Quality Check' THEN j.qc_remark
    WHEN t.stage = 'On Hold'       THEN j.halt_remark
    ELSE NULL
  END,
  CASE
    WHEN t.stage = 'Partial Dispatch' AND j.status = 'Partial Dispatch' THEN j.dispatched_qty
    WHEN t.stage = 'Dispatched'                                         THEN NULLIF(j.dispatched_qty, 0)
    ELSE NULL
  END
FROM job_stage_timestamps t
JOIN jobs j ON j.id = t.job_id
WHERE j.po_number LIKE 'DEMO-%';


COMMIT;


-- ── Verify ──────────────────────────────────────────────────
-- Expect 50 jobs and all 15 stages represented.
SELECT status, COUNT(*) AS jobs
FROM jobs
WHERE po_number LIKE 'DEMO-%'
GROUP BY status
ORDER BY jobs DESC, status;
