// src/app/track/[po]/page.tsx
// Server component — fetches job data server-side for instant first paint.
//
// Every read goes through the service-role client, on the server only. The
// anon role has no access to the client_* views or print_runs (migration
// 067), so nothing here can be replayed from a browser with the public anon
// key: the exact PO + Company Name gate below is the only way in. The
// service-role key never reaches the client (server component; the admin
// client is server-only).
//
// Each select names only the columns the /track UI renders — never the
// internal free-text `notes` on jobs, print_runs or dispatch_schedules.

export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { unstable_noStore as noStore } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import TrackJobAccordion from '@/components/track/TrackJobAccordion';
import TrackAutoRefresh from '@/components/track/TrackAutoRefresh';
import type { ClientStatusLog, DispatchSchedule, Job, JobStageTimestamp, PrintRun, RunStageTimestamp } from '@/lib/types';

type Params = {
  params: Promise<{ po: string }>;
  searchParams: Promise<{ id?: string; party?: string }>;
};

// Client-safe job fields actually rendered by the track components.
const JOB_COLUMNS =
  'id, po_number, pm_code, party, job_name, label_qty, po_date, delivery_date, status, job_type, ' +
  'urgent, urgent_priority, dispatched_qty, remaining_qty, halt_remark, qc_remark, ' +
  'is_scheduled_release, is_closed, total_qty_dispatched';

// Exact, case-insensitive match on one column. ILIKE with every LIKE
// metacharacter escaped (\ % _) behaves as case-insensitive equality, so a
// typed wildcard matches literally instead of widening the search.
// PostgREST rewrites `*` to `%` inside like/ilike values and offers no
// escape for it, so a term containing `*` falls back to a case-sensitive
// exact eq() — never a pattern.
function exactMatch(column: 'po_number' | 'pm_code', term: string) {
  const query = createAdminClient().from('client_job_view').select(JOB_COLUMNS);
  if (term.includes('*')) return query.eq(column, term);
  return query.ilike(column, term.replace(/[\\%_]/g, '\\$&'));
}

export default async function TrackJobPage({ params, searchParams }: Params) {
  noStore();
  const adminClient = createAdminClient();

  const { po } = await params;
  const { id: selectedJobId, party } = await searchParams;
  const searchTerm = decodeURIComponent(po).trim();
  const partyTerm = (party ?? '').trim();

  // Look up by the exact PO number or PM code (never a substring), AND
  // require the Company Name to match. PO numbers are assigned by each
  // client independently, so two different companies can genuinely share
  // the same PO number — without the Company Name filter, one client's
  // search could return another client's job. Job name is deliberately not
  // searchable so an outsider can't fish for orders by guessing product/
  // item names. The two lookups are separate column filters rather than an
  // .or() string, so user input is never parsed as PostgREST filter syntax.
  let jobs: Job[] = [];
  if (searchTerm.length >= 2 && partyTerm.length >= 2) {
    const [byPo, byPm] = await Promise.all([
      exactMatch('po_number', searchTerm),
      exactMatch('pm_code', searchTerm),
    ]);
    if (!byPo.error && !byPm.error) {
      // Company Name stays a case-insensitive contains-match, applied here
      // to the few rows sharing the exact PO, so it needs no DB pattern.
      const partyNeedle = partyTerm.toLowerCase();
      const seen = new Set<string>();
      for (const row of [...(byPo.data ?? []), ...(byPm.data ?? [])] as unknown as Job[]) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        if ((row.party ?? '').toLowerCase().includes(partyNeedle)) jobs.push(row);
      }
    }
  }

  if (jobs.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-2xl mb-2">🔍</p>
        <h2 className="text-lg font-semibold text-white mb-2">No Matching Job Found</h2>
        <p className="text-sm text-green-200">
          No result found for <strong>{searchTerm}</strong>
          {partyTerm && <> at <strong>{partyTerm}</strong></>}.
          Please check your PO Number/PM Code and Company Name and try again.
        </p>
        <a
          href="/track"
          className="inline-block mt-6 text-sm text-green-200 underline hover:text-white"
        >
          ← Search again
        </a>
      </div>
    );
  }

  // One query per table for every matched job at once, instead of four or
  // five per job — a party with ten open jobs used to cost ~50 round-trips,
  // and TrackAutoRefresh repeats the whole load every 30s. Rows are grouped
  // back per job below; each query's ORDER BY survives the grouping.
  const jobIds = jobs.map((j: Job) => j.id);
  const scheduledIds = jobs.filter((j: Job) => j.is_scheduled_release).map((j: Job) => j.id);

  const [logsRes, timestampsRes, schedulesRes, printRunsRes] = await Promise.all([
    adminClient
      .from('client_status_log_view')
      .select('id, job_id, status, department_display, changed_at, remark, qty_dispatched')
      .in('job_id', jobIds)
      .order('changed_at', { ascending: true }),
    adminClient
      .from('job_stage_timestamps')
      .select('id, job_id, stage, completed_at')
      .in('job_id', jobIds),
    // Scheduled releases for the matched jobs. This used to use the anon
    // key, but dispatch_schedules has RLS with no anon policy, so it always
    // came back empty. `notes` is left out: staff type it into the admin
    // "Notes (optional)" box with no hint that clients would see it.
    scheduledIds.length > 0
      ? adminClient
          .from('dispatch_schedules')
          .select('id, job_id, release_number, planned_qty, planned_date, actual_qty, actual_date, status')
          .in('job_id', scheduledIds)
          .order('release_number')
      : Promise.resolve({ data: [] }),
    // Always fetch — the client_job_view.has_partial_runs flag is unreliable
    // on drifted databases, so we render the runs card whenever runs exist.
    // Excludes `notes` — internal free text not meant for the client portal.
    adminClient
      .from('print_runs')
      .select('id, job_id, run_number, qty_this_run, qty_remaining_after, status, current_stage, started_at, dispatched_at, qc_remark, schedule_id')
      .in('job_id', jobIds)
      .order('run_number'),
  ]);

  const allRuns = (printRunsRes.data ?? []) as PrintRun[];

  // Per-run stage timestamps power the side-by-side ProductionRunsCard.
  // Fetched with the service-role client (the audit table is internal —
  // no anon access) and narrowed to client-safe fields before sending down.
  const { data: runLogs } = allRuns.length > 0
    ? await adminClient
        .from('print_run_stage_logs')
        .select('print_run_id, stage, changed_at')
        .in('print_run_id', allRuns.map((r) => r.id))
        .order('changed_at', { ascending: true })
    : { data: [] };

  function groupBy<T>(rows: T[] | null | undefined, key: (row: T) => string): Map<string, T[]> {
    const map = new Map<string, T[]>();
    for (const row of rows ?? []) {
      const k = key(row);
      const list = map.get(k);
      if (list) list.push(row);
      else map.set(k, [row]);
    }
    return map;
  }

  const logsByJob       = groupBy(logsRes.data as ClientStatusLog[] | null, (r) => r.job_id);
  const stampsByJob     = groupBy(timestampsRes.data as JobStageTimestamp[] | null, (r) => r.job_id);
  const schedulesByJob  = groupBy(schedulesRes.data as DispatchSchedule[] | null, (r) => r.job_id);
  const runsByJob       = groupBy(allRuns, (r) => r.job_id);
  // Run logs are grouped per job (via their run), not per run, so each job
  // keeps the same changed_at order across all its runs as before.
  const jobIdByRun      = new Map(allRuns.map((r) => [r.id, r.job_id]));
  const runLogsByJob    = groupBy(
    runLogs as RunStageTimestamp[] | null,
    (r) => jobIdByRun.get(r.print_run_id) ?? '',
  );

  const jobBundles = jobs.map((job: Job) => ({
    job,
    statusLogs:         logsByJob.get(job.id) ?? [],
    stageTimestamps:    stampsByJob.get(job.id) ?? [],
    schedules:          schedulesByJob.get(job.id) ?? [],
    printRuns:          runsByJob.get(job.id) ?? [],
    runStageTimestamps: runLogsByJob.get(job.id) ?? [],
  })) as Array<{
    job: Job;
    statusLogs: ClientStatusLog[];
    stageTimestamps: JobStageTimestamp[];
    schedules: DispatchSchedule[];
    printRuns: PrintRun[];
    runStageTimestamps: RunStageTimestamp[];
  }>;

  return (
    <div className="space-y-5">
      <TrackAutoRefresh />
      <TrackJobAccordion
        poNumber={searchTerm}
        partyTerm={partyTerm}
        jobs={jobBundles}
        initialJobId={selectedJobId}
      />
    </div>
  );
}
