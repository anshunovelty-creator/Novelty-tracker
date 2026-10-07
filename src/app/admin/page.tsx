// src/app/admin/page.tsx
// Server component — fetches initial data, passes to client components.

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { getDeptPermissions } from '@/lib/constants/departments';
import { redirect } from 'next/navigation';
import DashboardBoard from '@/components/admin/DashboardBoard';
import { deptKeyOf } from '@/lib/identity';

export default async function AdminPage() {
  const supabase = await createServerSupabaseClient();

  const user = await getClaimsUser(supabase);
  if (!user) redirect('/login');

  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!perms) redirect('/login');

  // Fetch initial jobs (server-side for first paint)
  // job_stage_timestamps(stage) join powers the stage control's step count and tick bar
  const { data: jobs } = await supabase
    .from('jobs')
    .select('*, job_stage_timestamps(stage), printing_units(id, name, printing_method), job_separations(rate, unit, material_name)')
    .eq('is_closed', false)
    .order('delivery_date', { ascending: true, nullsFirst: false });

  return (
    <>
      {/* Page header, machines strip + board, and the jobs table with its
          view tabs (Needs attention / Due this week / All active / Closed). */}
      <DashboardBoard dept={perms} jobs={jobs ?? []} />
    </>
  );
}
