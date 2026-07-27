// src/lib/export/adminExport.ts
// ============================================================
// Builds the admin data export: every job, every scheduled release and
// every print run, as three CSVs ready to be zipped.
//
// Read with the service-role client — the export is a full dump by
// design, so it must not be trimmed by the caller's RLS visibility.
// Callers are responsible for authenticating first.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { toCsv, csvDate, csvTimestamp, type CsvColumn } from './csv';
import type { Job, DispatchSchedule, PrintRun } from '@/lib/types';

// PostgREST caps a response at 1000 rows. Walk the table in pages so a
// growing jobs table does not silently truncate the export.
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

// ── Public API ────────────────────────────────────────────────

export interface ExportFile {
  name:    string;
  content: string;
}

export interface ExportResult {
  files:  ExportFile[];
  counts: { jobs: number; schedules: number; runs: number };
}

/** Read every job, release and run, and render them as CSV documents. */
export async function buildExportFiles(client: SupabaseClient<any>): Promise<ExportResult> {
  const [jobs, schedules, runs] = await Promise.all([
    fetchAll<Job>(client,              'jobs',               'created_at'),
    fetchAll<DispatchSchedule>(client, 'dispatch_schedules', 'created_at'),
    fetchAll<PrintRun>(client,         'print_runs',         'created_at'),
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

  return {
    files: [
      { name: 'jobs.csv',               content: toCsv(jobs,         JOB_COLUMNS) },
      { name: 'dispatch-schedules.csv', content: toCsv(scheduleRows, SCHEDULE_COLUMNS) },
      { name: 'print-runs.csv',         content: toCsv(runRows,      RUN_COLUMNS) },
    ],
    counts: { jobs: jobs.length, schedules: schedules.length, runs: runs.length },
  };
}
