// src/app/api/analytics/route.ts
// ============================================================
// GET /api/analytics?month=2026-06
// Returns on-time delivery rate for the given month (default: current month).
// Also returns dashboard summary counts.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { toMonthKey } from '@/lib/utils';

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const monthKey = new URL(request.url).searchParams.get('month') ?? toMonthKey();
  const admin = createAdminClient();

  // Run all dashboard queries in parallel
  const [
    activeCountRes,
    onHoldCountRes,
    dueThisWeekRes,
    dispatchedThisMonthRes,
    onTimeRes,
  ] = await Promise.all([
    // Total active (not closed)
    admin
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('is_closed', false),

    // On hold
    admin
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'On Hold')
      .eq('is_closed', false),

    // Due this week (today through +6 days)
    (() => {
      const today = new Date();
      const weekOut = new Date(today);
      weekOut.setDate(weekOut.getDate() + 6);
      return admin
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('is_closed', false)
        .gte('delivery_date', today.toISOString().slice(0, 10))
        .lte('delivery_date', weekOut.toISOString().slice(0, 10));
    })(),

    // Dispatched this month (from job_status_logs)
    admin
      .from('job_status_logs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'Dispatched')
      .gte('changed_at', `${monthKey}-01`)
      .lt('changed_at', nextMonthStart(monthKey)),

    // On-time dispatch log for this month
    admin
      .from('on_time_dispatch_log')
      .select('is_on_time')
      .eq('month_key', monthKey),
  ]);

  // Calculate on-time rate
  const onTimeLogs = onTimeRes.data ?? [];
  const total = onTimeLogs.length;
  const onTime = onTimeLogs.filter((r) => r.is_on_time === true).length;
  const onTimeRate = total > 0 ? Math.round((onTime / total) * 100) : null;

  return NextResponse.json({
    month_key:              monthKey,
    total_active:           activeCountRes.count ?? 0,
    on_hold_count:          onHoldCountRes.count ?? 0,
    due_this_week:          dueThisWeekRes.count ?? 0,
    dispatched_this_month:  dispatchedThisMonthRes.count ?? 0,
    on_time_delivery_rate:  onTimeRate,
    on_time_total:          total,
  });
}

function nextMonthStart(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  const next = month === 12
    ? `${year + 1}-01`
    : `${year}-${String(month + 1).padStart(2, '0')}`;
  return `${next}-01`;
}
