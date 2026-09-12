// src/lib/export/adminExport.ts
// ============================================================
// Builds the admin data export: every substantive dataset in the app,
// each as its own CSV ready to be zipped — jobs/releases/runs plus dies,
// flatbed dies, plates, label stock, job separations, Register (the
// customer CRM), Bill of Material (costings, requests, material master),
// and the Prepress Todo checklist
// (current state + history).
//
// Read with the service-role client — the export is a full dump by
// design, so it must not be trimmed by the caller's RLS visibility.
// Callers are responsible for authenticating first.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { toCsv, csvDate, csvTimestamp, type CsvColumn } from './csv';
import { materialExpense, orderDifference } from '@/lib/bom';
import type {
  Job, DispatchSchedule, PrintRun, Die, FlatbedDie, Plate, LabelStock,
  JobSeparation, RegisterAccount, RegisterDeal, RegisterActivity,
  BomMaterial, BomMaterialRequest,
  PrepressTodo, PrepressTodoLog,
} from '@/lib/types';

// PostgREST caps a response at 1000 rows. Walk the table in pages so a
// growing table does not silently truncate the export.
const PAGE_SIZE = 1000;

async function fetchAll<T>(
  client:  SupabaseClient<any>,
  table:   string,
  orderBy: string
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from(table)
      .select('*')
      // id breaks ties, so a row can never be skipped or repeated across pages
      .order(orderBy, { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(`Failed to read ${table}: ${error.message}`);
    if (!data?.length) break;

    rows.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break;
  }

  return rows;
}

// ── Row shapes with the columns we join on ────────────────────
// Each child CSV repeats the job's PO number and party so the file is
// readable on its own, without VLOOKUP-ing back into jobs.csv.

type ScheduleRow = DispatchSchedule & { po_number: string; party: string };
type RunRow      = PrintRun & {
  po_number:      string;
  party:          string;
  release_number: number | null;
};

type RegisterDealRow     = RegisterDeal & { account_name: string };
type RegisterActivityRow = RegisterActivity & { account_name: string; deal_title: string };

// One row per costed Job Separation row, carrying the job's identity and
// order value alongside the floor's inputs and the priced result — the
// same shape BomCostingTable's own export uses.
type BomCostingExportRow = {
  sr_no:             string | null;
  party:             string;
  po_no:             string | null;
  po_date:           string | null;
  pm_code:           string | null;
  product:           string | null;
  quantity:          number | null;
  order_value:       number | null;
  material:          string | null;
  rate_per_sqm:      number | null;
  material_width_mm: number | null;
  running_meter:     number | null;
  expense:           number | null;
  difference:        number | null;
  updated_by:        string | null;
  updated_at:        string;
};

// One row per material request, with the job it was raised against.
type BomRequestExportRow = BomMaterialRequest & {
  sr_no:   string | null;
  party:   string;
  po_no:   string | null;
  pm_code: string | null;
  product: string | null;
};

// Raw bom_costings row — expense is derived on the way out, never stored.
type BomCostingRaw = {
  job_separation_id: string;
  material_id:       string | null;
  material_width_mm: number | null;
  running_meter:     number | null;
  updated_by:        string | null;
  updated_at:        string;
};

// ── Column definitions ────────────────────────────────────────

const JOB_COLUMNS: CsvColumn<Job>[] = [
  { header: 'PO Number',            value: (j) => j.po_number },
  { header: 'PM Code',              value: (j) => j.pm_code },
  { header: 'Party',                value: (j) => j.party },
  { header: 'Job Name',             value: (j) => j.job_name },
  { header: 'Label Qty',            value: (j) => j.label_qty },
  { header: 'Job Type',             value: (j) => j.job_type },
  { header: 'Status',               value: (j) => j.status },
  { header: 'Urgent',               value: (j) => j.urgent },
  { header: 'Urgent Priority',      value: (j) => j.urgent_priority },
  { header: 'PO Date',              value: (j) => csvDate(j.po_date) },
  { header: 'Delivery Date',        value: (j) => csvDate(j.delivery_date) },
  { header: 'Dispatched Qty',       value: (j) => j.dispatched_qty },
  { header: 'Total Qty Dispatched', value: (j) => j.total_qty_dispatched },
  { header: 'Remaining Qty',        value: (j) => j.remaining_qty },
  { header: 'Scheduled Release',    value: (j) => j.is_scheduled_release },
  { header: 'Has Partial Runs',     value: (j) => j.has_partial_runs },
  { header: 'Closed',               value: (j) => j.is_closed },
  { header: 'Halt Remark',          value: (j) => j.halt_remark },
  { header: 'QC Remark',            value: (j) => j.qc_remark },
  { header: 'Notes',                value: (j) => j.notes },
  { header: 'Created At',           value: (j) => csvTimestamp(j.created_at) },
  { header: 'Last Updated',         value: (j) => csvTimestamp(j.updated_at) },
];

const SCHEDULE_COLUMNS: CsvColumn<ScheduleRow>[] = [
  { header: 'PO Number',      value: (s) => s.po_number },
  { header: 'Party',          value: (s) => s.party },
  { header: 'Release Number', value: (s) => s.release_number },
  { header: 'Planned Qty',    value: (s) => s.planned_qty },
  { header: 'Planned Date',   value: (s) => csvDate(s.planned_date) },
  { header: 'Actual Qty',     value: (s) => s.actual_qty },
  { header: 'Actual Date',    value: (s) => csvTimestamp(s.actual_date) },
  { header: 'Status',         value: (s) => s.status },
  { header: 'Notes',          value: (s) => s.notes },
  { header: 'Created At',     value: (s) => csvTimestamp(s.created_at) },
];

const RUN_COLUMNS: CsvColumn<RunRow>[] = [
  { header: 'PO Number',           value: (r) => r.po_number },
  { header: 'Party',               value: (r) => r.party },
  { header: 'Run Number',          value: (r) => r.run_number },
  { header: 'Fulfils Release',     value: (r) => r.release_number },
  { header: 'Qty This Run',        value: (r) => r.qty_this_run },
  { header: 'Qty Remaining After', value: (r) => r.qty_remaining_after },
  { header: 'Current Stage',       value: (r) => r.current_stage },
  { header: 'Status',              value: (r) => r.status },
  { header: 'Started At',          value: (r) => csvTimestamp(r.started_at) },
  { header: 'Dispatched At',       value: (r) => csvTimestamp(r.dispatched_at) },
  { header: 'QC Remark',           value: (r) => r.qc_remark },
  { header: 'Notes',               value: (r) => r.notes },
  { header: 'Created At',          value: (r) => csvTimestamp(r.created_at) },
];

const DIE_COLUMNS: CsvColumn<Die>[] = [
  { header: 'Status',          value: (d) => d.status },
  { header: 'Serial No',       value: (d) => d.serial_no },
  { header: 'Job Name',        value: (d) => d.job_name },
  { header: 'Corner',          value: (d) => d.corner },
  { header: 'Length',          value: (d) => d.length },
  { header: 'Width',           value: (d) => d.width },
  { header: 'Cylinder',        value: (d) => d.cylinder },
  { header: 'Material',        value: (d) => d.material },
  { header: 'Ups',             value: (d) => d.ups },
  { header: 'Gap',             value: (d) => d.gap },
  { header: 'Location',        value: (d) => d.location },
  { header: 'Die Received On', value: (d) => csvDate(d.die_received_on) },
  { header: 'Damage Date',     value: (d) => csvDate(d.damage_date) },
  { header: 'Damage Reason',   value: (d) => d.damage_reason },
  { header: 'Added',           value: (d) => csvTimestamp(d.created_at) },
];

const FLATBED_DIE_COLUMNS: CsvColumn<FlatbedDie>[] = [
  { header: 'Serial No',       value: (d) => d.serial_no },
  { header: 'Shape',           value: (d) => d.shape },
  { header: 'Corner',          value: (d) => d.corner },
  { header: 'Length',          value: (d) => d.length },
  { header: 'Width',           value: (d) => d.width },
  { header: 'Ups',             value: (d) => d.ups },
  { header: 'Gap',             value: (d) => d.gap },
  { header: 'Location',        value: (d) => d.location },
  { header: 'Die Received On', value: (d) => csvDate(d.die_received_on) },
  { header: 'Added',           value: (d) => csvTimestamp(d.created_at) },
];

const PLATE_COLUMNS: CsvColumn<Plate>[] = [
  { header: 'Plate ID',              value: (p) => p.plate_id },
  { header: 'Party',                 value: (p) => p.party },
  { header: 'PM Code',               value: (p) => p.pm_code },
  { header: 'Item Name',             value: (p) => p.item_name },
  { header: 'Across Size (H)',       value: (p) => p.across_size },
  { header: 'Around Size (W)',       value: (p) => p.around_size },
  { header: 'Cylinder',              value: (p) => p.cylinder },
  { header: 'Label Per Round',       value: (p) => p.label_per_round },
  { header: 'Location',              value: (p) => p.location },
  { header: 'Plate Date',            value: (p) => csvDate(p.plate_date) },
  { header: 'Added',                 value: (p) => csvTimestamp(p.created_at) },
];

const STOCK_COLUMNS: CsvColumn<LabelStock>[] = [
  { header: 'Kind',            value: (s) => s.kind },
  { header: 'Job Card Number', value: (s) => s.job_card_number },
  { header: 'PO Number',       value: (s) => s.po_number },
  { header: 'PM Code',         value: (s) => s.pm_code },
  { header: 'Party',           value: (s) => s.party },
  { header: 'Job Name',        value: (s) => s.job_name },
  { header: 'Qty',             value: (s) => s.qty },
  { header: 'Location',        value: (s) => s.location },
  { header: 'Remark',          value: (s) => s.remark },
  { header: 'Dispatched',      value: (s) => s.is_dispatched },
  { header: 'Dispatched At',   value: (s) => csvTimestamp(s.dispatched_at) },
  { header: 'Dispatched By',   value: (s) => s.dispatched_by },
  { header: 'Added',           value: (s) => csvTimestamp(s.created_at) },
];

const JOB_SEPARATION_COLUMNS: CsvColumn<JobSeparation>[] = [
  { header: 'Sr. No.',         value: (j) => j.sr_no },
  { header: 'Party',           value: (j) => j.party },
  { header: 'Po No',           value: (j) => j.po_no },
  { header: 'Po Date',         value: (j) => csvDate(j.po_date) },
  { header: 'PM Code',         value: (j) => j.pm_code },
  { header: 'Material Name',   value: (j) => j.material_name },
  { header: 'Quantity',        value: (j) => j.quantity },
  { header: 'Unit',            value: (j) => j.unit },
  { header: 'Artwork Status',  value: (j) => j.job_status },
  { header: 'Rate',            value: (j) => j.rate },
  { header: 'Order Value',     value: (j) => j.order_value },
  { header: 'Job Card Status', value: (j) => j.jc_status },
  { header: 'AW SENT to U1',   value: (j) => j.aw_send_to },
  { header: 'Cancelled',       value: (j) => Boolean(j.cancelled_at) },
  { header: 'Cancel Reason',   value: (j) => j.cancel_reason },
  { header: 'Added',           value: (j) => csvTimestamp(j.created_at) },
];

const REGISTER_ACCOUNT_COLUMNS: CsvColumn<RegisterAccount>[] = [
  { header: 'Name',         value: (a) => a.name },
  { header: 'Contact Name', value: (a) => a.contact_name },
  { header: 'Contact Role', value: (a) => a.contact_role },
  { header: 'Phone',        value: (a) => a.phone },
  { header: 'Email',        value: (a) => a.email },
  { header: 'Segment',      value: (a) => a.segment },
  { header: 'City',         value: (a) => a.city },
  { header: 'Notes',        value: (a) => a.notes },
  { header: 'Added',        value: (a) => csvTimestamp(a.created_at) },
];

const REGISTER_DEAL_COLUMNS: CsvColumn<RegisterDealRow>[] = [
  { header: 'Account',          value: (d) => d.account_name },
  { header: 'Title',            value: (d) => d.title },
  { header: 'Stage',            value: (d) => d.stage },
  { header: 'Owner',            value: (d) => d.owner },
  { header: 'Qty',              value: (d) => d.qty },
  { header: 'Value',            value: (d) => d.value },
  { header: 'Substrate',        value: (d) => d.substrate },
  { header: 'Next Action',      value: (d) => d.next_action },
  { header: 'Next Action Date', value: (d) => csvDate(d.next_action_date) },
  { header: 'Status',           value: (d) => d.status },
  { header: 'Lost Reason',      value: (d) => d.lost_reason },
  { header: 'Closed At',        value: (d) => csvTimestamp(d.closed_at) },
  { header: 'Added',            value: (d) => csvTimestamp(d.created_at) },
];

const REGISTER_ACTIVITY_COLUMNS: CsvColumn<RegisterActivityRow>[] = [
  { header: 'Account', value: (a) => a.account_name },
  { header: 'Deal',    value: (a) => a.deal_title },
  { header: 'Date',    value: (a) => csvDate(a.date) },
  { header: 'Type',    value: (a) => a.type },
  { header: 'By',      value: (a) => a.by },
  { header: 'Note',    value: (a) => a.note },
  { header: 'Added',   value: (a) => csvTimestamp(a.created_at) },
];

const BOM_COSTING_COLUMNS: CsvColumn<BomCostingExportRow>[] = [
  { header: 'Sr. No.',        value: (r) => r.sr_no },
  { header: 'Party',          value: (r) => r.party },
  { header: 'PO No',          value: (r) => r.po_no },
  { header: 'PO Date',        value: (r) => csvDate(r.po_date) },
  { header: 'PM Code',        value: (r) => r.pm_code },
  { header: 'Product',        value: (r) => r.product },
  { header: 'Quantity',       value: (r) => r.quantity },
  { header: 'Order Value',    value: (r) => r.order_value },
  { header: 'Material',       value: (r) => r.material },
  { header: 'Rate per sq m',  value: (r) => r.rate_per_sqm },
  { header: 'Width (mm)',     value: (r) => r.material_width_mm },
  { header: 'Running (m)',    value: (r) => r.running_meter },
  { header: 'Expense',        value: (r) => r.expense },
  { header: 'Difference',     value: (r) => r.difference },
  { header: 'Updated By',     value: (r) => r.updated_by },
  { header: 'Updated At',     value: (r) => csvTimestamp(r.updated_at) },
];

const BOM_REQUEST_COLUMNS: CsvColumn<BomRequestExportRow>[] = [
  { header: 'Ref',            value: (r) => r.ref },
  { header: 'Status',         value: (r) => r.status },
  { header: 'Sr. No.',        value: (r) => r.sr_no },
  { header: 'Party',          value: (r) => r.party },
  { header: 'PO No',          value: (r) => r.po_no },
  { header: 'PM Code',        value: (r) => r.pm_code },
  { header: 'Product',        value: (r) => r.product },
  { header: 'Material',       value: (r) => r.material_name },
  { header: 'Width (mm)',     value: (r) => r.material_width_mm },
  { header: 'Running (m)',    value: (r) => r.running_meter },
  { header: 'Rate per sq m',  value: (r) => r.rate_per_sqm },
  { header: 'Expense',        value: (r) => r.expense },
  { header: 'Order Value',    value: (r) => r.order_value },
  { header: 'Message',        value: (r) => r.message },
  { header: 'Requested',      value: (r) => r.requested_by_department },
  { header: 'Requested By',   value: (r) => r.requested_by },
  { header: 'Requested At',   value: (r) => csvTimestamp(r.created_at) },
  { header: 'Decision Note',  value: (r) => r.decision_note },
  { header: 'Decided At',     value: (r) => csvTimestamp(r.decided_at) },
  { header: 'Decided By',     value: (r) => r.decided_by },
];

const BOM_MATERIAL_COLUMNS: CsvColumn<BomMaterial>[] = [
  { header: 'Name',          value: (m) => m.name },
  { header: 'Specification', value: (m) => m.specification },
  { header: 'Rate per sq m', value: (m) => m.rate_per_sqm },
  { header: 'Active',        value: (m) => (m.is_active ? 'Yes' : 'No') },
  { header: 'Added',         value: (m) => csvTimestamp(m.created_at) },
  { header: 'Updated',       value: (m) => csvTimestamp(m.updated_at) },
];

const PREPRESS_TODO_COLUMNS: CsvColumn<PrepressTodo>[] = [
  { header: 'Task',           value: (t) => t.task },
  { header: 'Marked Read At', value: (t) => csvTimestamp(t.marked_read_at) },
  { header: 'Added',          value: (t) => csvTimestamp(t.created_at) },
];

const PREPRESS_TODO_LOG_COLUMNS: CsvColumn<PrepressTodoLog>[] = [
  { header: 'Task',       value: (l) => l.task },
  { header: 'Action',     value: (l) => l.action },
  { header: 'Department', value: (l) => l.actor_department },
  { header: 'Actor',      value: (l) => l.actor_email },
  { header: 'When',       value: (l) => csvTimestamp(l.created_at) },
];

// ── Public API ────────────────────────────────────────────────

export interface ExportFile {
  name:    string;
  content: string;
}

export interface ExportResult {
  files:  ExportFile[];
  counts: Record<string, number>;
}

/** Read every dataset in the app and render each as its own CSV document. */
export async function buildExportFiles(client: SupabaseClient<any>): Promise<ExportResult> {
  const [
    jobs, schedules, runs, dies, flatbedDies, plates, stock, jobSeparations,
    registerAccounts, registerDeals, registerActivities,
    bomCostings, bomRequests, bomMaterials,
    prepressTodos, prepressTodoLogs,
  ] = await Promise.all([
    fetchAll<Job>(client,               'jobs',                     'created_at'),
    fetchAll<DispatchSchedule>(client,  'dispatch_schedules',       'created_at'),
    fetchAll<PrintRun>(client,          'print_runs',               'created_at'),
    fetchAll<Die>(client,               'dies',                     'created_at'),
    fetchAll<FlatbedDie>(client,        'flatbed_dies',             'created_at'),
    fetchAll<Plate>(client,             'plates',                   'created_at'),
    fetchAll<LabelStock>(client,        'label_stock',              'created_at'),
    fetchAll<JobSeparation>(client,     'job_separations',          'created_at'),
    fetchAll<RegisterAccount>(client,   'register_accounts',        'created_at'),
    fetchAll<RegisterDeal>(client,      'register_deals',           'created_at'),
    fetchAll<RegisterActivity>(client,  'register_activities',      'created_at'),
    fetchAll<BomCostingRaw>(client,       'bom_costings',             'updated_at'),
    fetchAll<BomMaterialRequest>(client,  'bom_material_requests',    'created_at'),
    fetchAll<BomMaterial>(client,         'bom_materials',            'name'),
    fetchAll<PrepressTodo>(client,      'prepress_todos',           'created_at'),
    fetchAll<PrepressTodoLog>(client,   'prepress_todo_logs',       'created_at'),
  ]);

  const jobsById = new Map(jobs.map((j) => [j.id, j]));
  // A run points at the schedule it fulfils; resolve that to the release
  // number an operator would recognise.
  const releaseByScheduleId = new Map(schedules.map((s) => [s.id, s.release_number]));

  const scheduleRows: ScheduleRow[] = schedules.map((s) => ({
    ...s,
    po_number: jobsById.get(s.job_id)?.po_number ?? '',
    party:     jobsById.get(s.job_id)?.party     ?? '',
  }));

  const runRows: RunRow[] = runs.map((r) => ({
    ...r,
    po_number:      jobsById.get(r.job_id)?.po_number ?? '',
    party:          jobsById.get(r.job_id)?.party     ?? '',
    release_number: r.schedule_id ? releaseByScheduleId.get(r.schedule_id) ?? null : null,
  }));

  const accountsById = new Map(registerAccounts.map((a) => [a.id, a]));
  const dealsById     = new Map(registerDeals.map((d) => [d.id, d]));

  const registerDealRows: RegisterDealRow[] = registerDeals.map((d) => ({
    ...d,
    account_name: accountsById.get(d.account_id)?.name ?? '',
  }));

  const registerActivityRows: RegisterActivityRow[] = registerActivities.map((a) => ({
    ...a,
    account_name: accountsById.get(a.account_id)?.name ?? '',
    deal_title:   a.deal_id ? dealsById.get(a.deal_id)?.title ?? '' : '',
  }));

  const jobSeparationsById = new Map(jobSeparations.map((j) => [j.id, j]));
  const bomMaterialsById   = new Map(bomMaterials.map((m) => [m.id, m]));

  // Priced here exactly as the API prices them — from the material's
  // current rate — so the export never disagrees with the screen.
  const bomCostingRows: BomCostingExportRow[] = bomCostings
    .map((c) => {
      const job = jobSeparationsById.get(c.job_separation_id);
      if (!job) return null;
      const material = c.material_id ? bomMaterialsById.get(c.material_id) : undefined;
      const rate     = material ? Number(material.rate_per_sqm) : null;
      const width    = c.material_width_mm === null ? null : Number(c.material_width_mm);
      const metres   = c.running_meter === null ? null : Number(c.running_meter);
      const expense  = materialExpense(metres, width, rate);
      return {
        sr_no:             job.sr_no,
        party:             job.party,
        po_no:             job.po_no,
        po_date:           job.po_date,
        pm_code:           job.pm_code,
        product:           job.material_name,
        quantity:          job.quantity,
        order_value:       job.order_value,
        material:          material?.name ?? null,
        rate_per_sqm:      rate,
        material_width_mm: width,
        running_meter:     metres,
        expense,
        difference:        orderDifference(job.order_value, expense),
        updated_by:        c.updated_by,
        updated_at:        c.updated_at,
      };
    })
    .filter((row): row is BomCostingExportRow => row !== null);

  const bomRequestRows: BomRequestExportRow[] = bomRequests.map((r) => {
    const job = jobSeparationsById.get(r.job_separation_id);
    return {
      ...r,
      sr_no:   job?.sr_no ?? null,
      party:   job?.party ?? '',
      po_no:   job?.po_no ?? null,
      pm_code: job?.pm_code ?? null,
      product: job?.material_name ?? null,
    };
  });

  return {
    files: [
      { name: 'jobs.csv',                    content: toCsv(jobs,                 JOB_COLUMNS) },
      { name: 'dispatch-schedules.csv',      content: toCsv(scheduleRows,         SCHEDULE_COLUMNS) },
      { name: 'print-runs.csv',              content: toCsv(runRows,              RUN_COLUMNS) },
      { name: 'dies.csv',                    content: toCsv(dies,                 DIE_COLUMNS) },
      { name: 'flatbed-dies.csv',            content: toCsv(flatbedDies,          FLATBED_DIE_COLUMNS) },
      { name: 'plates.csv',                  content: toCsv(plates,               PLATE_COLUMNS) },
      { name: 'label-stock.csv',             content: toCsv(stock,                STOCK_COLUMNS) },
      { name: 'job-separations.csv',         content: toCsv(jobSeparations,       JOB_SEPARATION_COLUMNS) },
      { name: 'register-accounts.csv',       content: toCsv(registerAccounts,     REGISTER_ACCOUNT_COLUMNS) },
      { name: 'register-deals.csv',          content: toCsv(registerDealRows,     REGISTER_DEAL_COLUMNS) },
      { name: 'register-activities.csv',     content: toCsv(registerActivityRows, REGISTER_ACTIVITY_COLUMNS) },
      { name: 'bom-costings.csv',            content: toCsv(bomCostingRows,       BOM_COSTING_COLUMNS) },
      { name: 'bom-requests.csv',            content: toCsv(bomRequestRows,       BOM_REQUEST_COLUMNS) },
      { name: 'bom-materials.csv',           content: toCsv(bomMaterials,         BOM_MATERIAL_COLUMNS) },
      { name: 'prepress-todo.csv',           content: toCsv(prepressTodos,        PREPRESS_TODO_COLUMNS) },
      { name: 'prepress-todo-history.csv',   content: toCsv(prepressTodoLogs,     PREPRESS_TODO_LOG_COLUMNS) },
    ],
    counts: {
      jobs: jobs.length, schedules: schedules.length, runs: runs.length,
      dies: dies.length, flatbedDies: flatbedDies.length, plates: plates.length,
      stock: stock.length, jobSeparations: jobSeparations.length,
      registerAccounts: registerAccounts.length, registerDeals: registerDeals.length,
      registerActivities: registerActivities.length, bomCostings: bomCostingRows.length,
      bomRequests: bomRequestRows.length, bomMaterials: bomMaterials.length,
      prepressTodos: prepressTodos.length,
      prepressTodoLogs: prepressTodoLogs.length,
    },
  };
}
