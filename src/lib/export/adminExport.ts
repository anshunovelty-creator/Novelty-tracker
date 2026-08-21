// src/lib/export/adminExport.ts
// ============================================================
// Builds the admin data export: every substantive dataset in the app,
// each as its own CSV ready to be zipped — jobs/releases/runs plus dies,
// flatbed dies, plates, label stock, job separations, Register (the
// customer CRM), Bill of Materials, and the Prepress Todo checklist
// (current state + history).
//
// Read with the service-role client — the export is a full dump by
// design, so it must not be trimmed by the caller's RLS visibility.
// Callers are responsible for authenticating first.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { toCsv, csvDate, csvTimestamp, type CsvColumn } from './csv';
import type {
  Job, DispatchSchedule, PrintRun, Die, FlatbedDie, Plate, LabelStock,
  JobSeparation, RegisterAccount, RegisterDeal, RegisterActivity,
  BomRequest, BomRequestItem, BomMaterial, BomRequestStatus, BomPriority,
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

// One row per BOM line item, carrying its parent request's header fields
// alongside — matches the flattened shape BomManager's own export already
// uses, so the export reads the same way an operator already expects.
type BomLineRow = BomRequestItem & {
  ref:                  string;
  request_status:       BomRequestStatus;
  priority:             BomPriority;
  job_po:               string | null;
  party:                string | null;
  needed_by:            string | null;
  raised_by_department: string;
  raised_by:            string | null;
  request_note:         string | null;
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

const BOM_COLUMNS: CsvColumn<BomLineRow>[] = [
  { header: 'Ref',                  value: (i) => i.ref },
  { header: 'Status',               value: (i) => i.request_status },
  { header: 'Priority',             value: (i) => i.priority },
  { header: 'For Job/PO',           value: (i) => i.job_po },
  { header: 'Party',                value: (i) => i.party },
  { header: 'Needed By',            value: (i) => csvDate(i.needed_by) },
  { header: 'Raised',               value: (i) => i.raised_by_department },
  { header: 'Raised By',            value: (i) => i.raised_by },
  { header: 'Request Note',         value: (i) => i.request_note },
  { header: 'Material',             value: (i) => i.material },
  { header: 'Specification',        value: (i) => i.specification },
  { header: 'Size',                 value: (i) => i.size },
  { header: 'Qty Requested',        value: (i) => i.quantity },
  { header: 'Unit',                 value: (i) => i.unit },
  { header: 'Line Note',            value: (i) => i.note },
  { header: 'Decision',             value: (i) => i.decision },
  { header: 'Qty Approved',         value: (i) => i.approved_quantity },
  { header: 'Alternative',          value: (i) => i.alternative_material },
  { header: 'Decision Note',        value: (i) => i.decision_note },
  { header: 'Decided At',           value: (i) => csvTimestamp(i.decided_at) },
];

const BOM_MATERIAL_COLUMNS: CsvColumn<BomMaterial>[] = [
  { header: 'Name',          value: (m) => m.name },
  { header: 'Specification', value: (m) => m.specification },
  { header: 'Default Size',  value: (m) => m.default_size },
  { header: 'Default Unit',  value: (m) => m.default_unit },
  { header: 'Added',         value: (m) => csvTimestamp(m.created_at) },
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
    bomRequests, bomRequestItems, bomMaterials,
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
    fetchAll<BomRequest>(client,        'bom_requests',             'created_at'),
    fetchAll<BomRequestItem>(client,    'bom_request_items',        'position'),
    fetchAll<BomMaterial>(client,       'bom_materials',            'name'),
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

  const bomRequestsById = new Map(bomRequests.map((r) => [r.id, r]));
  const bomLineRows: BomLineRow[] = bomRequestItems
    .map((item) => {
      const req = bomRequestsById.get(item.request_id);
      if (!req) return null;
      return {
        ...item,
        ref:                  req.ref,
        request_status:       req.status,
        priority:             req.priority,
        job_po:               req.job_po,
        party:                req.party,
        needed_by:            req.needed_by,
        raised_by_department: req.raised_by_department,
        raised_by:            req.raised_by,
        request_note:         req.note,
      };
    })
    .filter((row): row is BomLineRow => row !== null);

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
      { name: 'bill-of-materials.csv',       content: toCsv(bomLineRows,          BOM_COLUMNS) },
      { name: 'bom-materials-catalog.csv',   content: toCsv(bomMaterials,         BOM_MATERIAL_COLUMNS) },
      { name: 'prepress-todo.csv',           content: toCsv(prepressTodos,        PREPRESS_TODO_COLUMNS) },
      { name: 'prepress-todo-history.csv',   content: toCsv(prepressTodoLogs,     PREPRESS_TODO_LOG_COLUMNS) },
    ],
    counts: {
      jobs: jobs.length, schedules: schedules.length, runs: runs.length,
      dies: dies.length, flatbedDies: flatbedDies.length, plates: plates.length,
      stock: stock.length, jobSeparations: jobSeparations.length,
      registerAccounts: registerAccounts.length, registerDeals: registerDeals.length,
      registerActivities: registerActivities.length, bomLines: bomLineRows.length,
      bomMaterials: bomMaterials.length, prepressTodos: prepressTodos.length,
      prepressTodoLogs: prepressTodoLogs.length,
    },
  };
}
