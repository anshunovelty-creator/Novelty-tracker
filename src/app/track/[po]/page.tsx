// src/app/track/[po]/page.tsx
// Server component — fetches job data server-side for instant first paint.
// Uses the anon Supabase key via client_job_view + client_status_log_view.

export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { createClient } from '@supabase/supabase-js';
import { unstable_noStore as noStore } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import TrackJobAccordion from '@/components/track/TrackJobAccordion';
import TrackAutoRefresh from '@/components/track/TrackAutoRefresh';
import type { ClientStatusLog, DispatchSchedule, Job, JobStageTimestamp, PrintRun, RunStageTimestamp } from '@/lib/types';

type Params = {
  params: Promise<{ po: string }>;
  searchParams: Promise<{ id?: string }>;
};

// Anon client for public reads — reads through client_job_view and client_status_log_view
const anonClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default async function TrackJobPage({ params, searchParams }: Params) {
  noStore();
  const adminClient = createAdminClient();

  const { po } = await params;
  const { id: selectedJobId } = await searchParams;
  const searchTerm = decodeURIComponent(po).trim();

  // Search by PO number OR job name.
  const { data: jobs, error } = await anonClient
    .from('client_job_view')
    .select('*')
    .or(`po_number.ilike.%${searchTerm}%,job_name.ilike.%${searchTerm}%`);

  if (error || !jobs || jobs.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-2xl mb-2">🔍</p>
        <h2 className="text-lg font-semibold text-white mb-2">No Matching Job Found</h2>
        <p className="text-sm text-green-200">
          No result found for <strong>{searchTerm}</strong>.
          Please check and try again.
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

  const jobBundles = await Promise.all(
    jobs.map(async (job: Job) => {
      const [logsRes, timestampsRes, schedulesRes, printRunsRes] = await Promise.all([
        anonClient
          .from('client_status_log_view')
          .select('*')
          .eq('job_id', job.id)
          .order('changed_at', { ascending: true }),
        adminClient
          .from('job_stage_timestamps')
          .select('*')
          .eq('job_id', job.id),
        job.is_scheduled_release
          ? anonClient
              .from('dispatch_schedules')
              .select('*')
              .eq('job_id', job.id)
              .order('release_number')
          : Promise.resolve({ data: [] }),
        // Always fetch — the client_job_view.has_partial_runs flag is unreliable
        // on drifted databases, so we render the runs card whenever runs exist.
        anonClient
          .from('print_runs')
          .select('*')
          .eq('job_id', job.id)
          .order('run_number'),
      ]);

      const printRuns = (printRunsRes.data ?? []) as PrintRun[];

      // Per-run stage timestamps power the side-by-side ProductionRunsCard.
      // Fetched with the service-role client (the audit table is internal —
      // no anon access) and narrowed to client-safe fields before sending down.
      let runStageTimestamps: RunStageTimestamp[] = [];
      if (printRuns.length > 0) {
        const { data: logs } = await adminClient
          .from('print_run_stage_logs')
          .select('print_run_id, stage, changed_at')
          .in('print_run_id', printRuns.map((r) => r.id))
          .order('changed_at', { ascending: true });
        runStageTimestamps = (logs ?? []) as RunStageTimestamp[];
      }

      return {
        job,
        statusLogs: logsRes.data ?? [],
        stageTimestamps: timestampsRes.data ?? [],
        schedules: schedulesRes.data ?? [],
        printRuns,
        runStageTimestamps,
      };
    })
  ) as Array<{
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
        jobs={jobBundles}
        initialJobId={selectedJobId}
      />
    </div>
  );
}
