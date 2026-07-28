// src/app/admin/page.tsx
// Server component — fetches initial data, passes to client components.

import Link from 'next/link';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { parseDepartment } from '@/lib/constants/departments';
import { redirect } from 'next/navigation';
import DashboardSummaryCard from '@/components/admin/DashboardSummaryCard';
import MachineBoard from '@/components/admin/MachineBoard';
import JobsTable from '@/components/admin/JobsTable';

export default async function AdminPage() {
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const dept = parseDepartment(user.user_metadata?.department);
  if (!dept) redirect('/login');

  // Fetch initial jobs (server-side for first paint)
  // job_stage_timestamps(stage) join powers the ✓ marks in the status dropdown
  const { data: jobs } = await supabase
    .from('jobs')
    .select('*, job_stage_timestamps(stage), printing_units(id, name, printing_method)')
    .eq('is_closed', false)
    .order('delivery_date', { ascending: true, nullsFirst: false });

  // Fetch dashboard summary directly from DB (avoids auth-cookie issue with internal fetch)
  const today    = new Date();
  const weekOut  = new Date(today); weekOut.setDate(weekOut.getDate() + 6);
  const monthStart = today.toISOString().slice(0, 7) + '-01'; // 'YYYY-MM-01'
  const nextMonth  = new Date(today.getFullYear(), today.getMonth() + 1, 1).toISOString().slice(0, 10);

  const [activeRes, holdRes, weekRes, dispatchedRes] = await Promise.all([
    supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('is_closed', false),
    supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('status', 'On Hold').eq('is_closed', false),
    supabase.from('jobs').select('id', { count: 'exact', head: true })
      .eq('is_closed', false)
      .gte('delivery_date', today.toISOString().slice(0, 10))
      .lte('delivery_date', weekOut.toISOString().slice(0, 10)),
    supabase.from('job_status_logs').select('id', { count: 'exact', head: true })
      .eq('status', 'Dispatched')
      .gte('changed_at', monthStart)
      .lt('changed_at', nextMonth),
  ]);

  const summary = {
    total_active:           activeRes.count     ?? 0,
    on_hold_count:          holdRes.count        ?? 0,
    due_this_week:          weekRes.count        ?? 0,
    dispatched_this_month:  dispatchedRes.count  ?? 0,
    on_time_delivery_rate:  null, // loaded via /api/analytics on demand
  };

  return (
    <div className="space-y-6">
      {/* Dashboard summary */}
      <DashboardSummaryCard summary={summary} />

      {/* Machine board — live per-machine printing queues */}
      <MachineBoard dept={dept} />

      {/* Admin-only settings entry points */}
      {dept === 'Admin' && (
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/printing-units"
            className="inline-flex min-h-11 items-center rounded-lg border border-black/[0.12] px-3 text-sm text-[var(--glass-muted)] hover:bg-black/[0.04] hover:text-[var(--glass-ink)]"
          >
            Manage printing units →
          </Link>
        </div>
      )}

      {/* Add job form + jobs table */}
      <JobsTable
        initialJobs={jobs ?? []}
        dept={dept}
      />
    </div>
  );
}
