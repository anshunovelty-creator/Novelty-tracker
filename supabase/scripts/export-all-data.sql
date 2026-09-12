-- supabase/scripts/export-all-data.sql
-- ============================================================
-- Standalone backup script — run directly in the Supabase SQL Editor,
-- no app deploy required. Mirrors exactly the 15 datasets the navbar
-- "Export" button bundles into a ZIP (see src/lib/export/adminExport.ts),
-- as plain SELECTs instead of app code.
--
-- HOW TO USE:
-- The SQL Editor only lets you download ONE query's result at a time.
-- Run ONE section below (select from "-- === NAME ===" down to its
-- semicolon), let it finish, click "Download CSV" on the results grid,
-- then move to the next section. Running the whole file at once only
-- shows/downloads the LAST query's result.
--
-- This is a read-only script — every statement here is a SELECT. It
-- never writes, updates, or deletes anything.
-- ============================================================

-- === 1. JOBS ===
select
  po_number as "PO Number", pm_code as "PM Code", party as "Party",
  job_name as "Job Name", label_qty as "Label Qty", job_type as "Job Type",
  status as "Status", urgent as "Urgent", urgent_priority as "Urgent Priority",
  po_date as "PO Date", delivery_date as "Delivery Date",
  dispatched_qty as "Dispatched Qty", total_qty_dispatched as "Total Qty Dispatched",
  remaining_qty as "Remaining Qty", is_scheduled_release as "Scheduled Release",
  has_partial_runs as "Has Partial Runs", is_closed as "Closed",
  halt_remark as "Halt Remark", qc_remark as "QC Remark", notes as "Notes",
  created_at as "Created At", updated_at as "Last Updated"
from jobs
order by created_at;

-- === 2. DISPATCH SCHEDULES ===
select
  j.po_number as "PO Number", j.party as "Party",
  s.release_number as "Release Number", s.planned_qty as "Planned Qty",
  s.planned_date as "Planned Date", s.actual_qty as "Actual Qty",
  s.actual_date as "Actual Date", s.status as "Status", s.notes as "Notes",
  s.created_at as "Created At"
from dispatch_schedules s
left join jobs j on j.id = s.job_id
order by s.created_at;

-- === 3. PRINT RUNS ===
select
  j.po_number as "PO Number", j.party as "Party",
  r.run_number as "Run Number", ds.release_number as "Fulfils Release",
  r.qty_this_run as "Qty This Run", r.qty_remaining_after as "Qty Remaining After",
  r.current_stage as "Current Stage", r.status as "Status",
  r.started_at as "Started At", r.dispatched_at as "Dispatched At",
  r.qc_remark as "QC Remark", r.notes as "Notes", r.created_at as "Created At"
from print_runs r
left join jobs j on j.id = r.job_id
left join dispatch_schedules ds on ds.id = r.schedule_id
order by r.created_at;

-- === 4. DIES ===
select
  status as "Status", serial_no as "Serial No", job_name as "Job Name",
  corner as "Corner", length as "Length", width as "Width",
  cylinder as "Cylinder", material as "Material", ups as "Ups", gap as "Gap",
  location as "Location", die_received_on as "Die Received On",
  damage_date as "Damage Date", damage_reason as "Damage Reason",
  created_at as "Added"
from dies
order by created_at;

-- === 5. FLATBED DIES ===
select
  serial_no as "Serial No", shape as "Shape", corner as "Corner",
  length as "Length", width as "Width", ups as "Ups", gap as "Gap",
  location as "Location", die_received_on as "Die Received On",
  created_at as "Added"
from flatbed_dies
order by created_at;

-- === 6. PLATES ===
select
  plate_id as "Plate ID", party as "Party", pm_code as "PM Code",
  item_name as "Item Name", across_size as "Across Size (H)",
  around_size as "Around Size (W)", cylinder as "Cylinder",
  label_per_round as "Label Per Round", location as "Location",
  plate_date as "Plate Date", created_at as "Added"
from plates
order by created_at;

-- === 7. LABEL STOCK ===
select
  kind as "Kind", job_card_number as "Job Card Number",
  po_number as "PO Number", pm_code as "PM Code", party as "Party",
  job_name as "Job Name", qty as "Qty", location as "Location",
  remark as "Remark", is_dispatched as "Dispatched",
  dispatched_at as "Dispatched At", dispatched_by as "Dispatched By",
  created_at as "Added"
from label_stock
order by created_at;

-- === 8. JOB SEPARATIONS ===
select
  sr_no as "Sr. No.", party as "Party", po_no as "Po No", po_date as "Po Date",
  pm_code as "PM Code", material_name as "Material Name", quantity as "Quantity",
  unit as "Unit", job_status as "Artwork Status", rate as "Rate",
  order_value as "Order Value", jc_status as "Job Card Status",
  aw_send_to as "AW SENT to U1", (cancelled_at is not null) as "Cancelled",
  cancel_reason as "Cancel Reason", created_at as "Added"
from job_separations
order by created_at;

-- === 9. REGISTER ACCOUNTS ===
select
  name as "Name", contact_name as "Contact Name", contact_role as "Contact Role",
  phone as "Phone", email as "Email", segment as "Segment", city as "City",
  notes as "Notes", created_at as "Added"
from register_accounts
order by created_at;

-- === 10. REGISTER DEALS ===
select
  a.name as "Account", d.title as "Title", d.stage as "Stage",
  d.owner as "Owner", d.qty as "Qty", d.value as "Value",
  d.substrate as "Substrate", d.next_action as "Next Action",
  d.next_action_date as "Next Action Date", d.status as "Status",
  d.lost_reason as "Lost Reason", d.closed_at as "Closed At",
  d.created_at as "Added"
from register_deals d
left join register_accounts a on a.id = d.account_id
order by d.created_at;

-- === 11. REGISTER ACTIVITIES ===
select
  a.name as "Account", dl.title as "Deal", act.date as "Date",
  act.type as "Type", act.by as "By", act.note as "Note",
  act.created_at as "Added"
from register_activities act
left join register_accounts a on a.id = act.account_id
left join register_deals dl on dl.id = act.deal_id
order by act.created_at;

-- === 12. BOM COSTINGS (order value vs material cost, per job) ===
select
  j.sr_no as "Sr. No.", j.party as "Party", j.po_no as "PO No", j.po_date as "PO Date",
  j.pm_code as "PM Code", j.material_name as "Product", j.quantity as "Quantity",
  j.order_value as "Order Value",
  m.name as "Material", m.rate_per_sqm as "Rate per sq m",
  c.material_width_mm as "Width (mm)", c.running_meter as "Running (m)",
  round(c.running_meter * (c.material_width_mm / 1000) * m.rate_per_sqm, 2) as "Expense",
  round(j.order_value - c.running_meter * (c.material_width_mm / 1000) * m.rate_per_sqm, 2) as "Difference",
  c.updated_by as "Updated By", c.updated_at as "Updated At"
from bom_costings c
join job_separations j on j.id = c.job_separation_id
left join bom_materials m on m.id = c.material_id
order by j.created_at;

-- === 12b. BOM MATERIAL REQUESTS ===
select
  r.ref as "Ref", r.status as "Status",
  j.sr_no as "Sr. No.", j.party as "Party", j.po_no as "PO No", j.pm_code as "PM Code",
  j.material_name as "Product",
  r.material_name as "Material", r.material_width_mm as "Width (mm)",
  r.running_meter as "Running (m)", r.rate_per_sqm as "Rate per sq m",
  r.expense as "Expense", r.order_value as "Order Value", r.message as "Message",
  r.requested_by_department as "Requested", r.requested_by as "Requested By",
  r.created_at as "Requested At",
  r.decision_note as "Decision Note", r.decided_at as "Decided At", r.decided_by as "Decided By"
from bom_material_requests r
left join job_separations j on j.id = r.job_separation_id
order by r.created_at;

-- === 13. BOM MATERIALS (master list) ===
select
  name as "Name", specification as "Specification", rate_per_sqm as "Rate per sq m",
  is_active as "Active", created_at as "Added", updated_at as "Updated"
from bom_materials
order by name;

-- === 14. PREPRESS TODO (current checklist) ===
select
  task as "Task", marked_read_at as "Marked Read At", created_at as "Added"
from prepress_todos
order by created_at;

-- === 15. PREPRESS TODO HISTORY ===
select
  task as "Task", action as "Action", actor_department as "Department",
  actor_email as "Actor", created_at as "When"
from prepress_todo_logs
order by created_at;
