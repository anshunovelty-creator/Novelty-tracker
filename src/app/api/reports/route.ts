// src/app/api/reports/route.ts
// ============================================================
// GET /api/reports?month=2026-09 — the Reports page (Admin only).
// ============================================================
//
// Fetches the raw rows and hands them to buildReport (lib/reports.ts):
//   - on_time_dispatch_log for the six months the trend chart covers
//   - job_status_logs from the start of the previous month onward — the
//     previous month for the "vs last month" figures, and everything after
//     the chosen month so a stage spell that started in it can end later.
// Also returns that month's dispatch events for the CSV export.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions } from '@/lib/constants/departments';
import { istToday } from '@/lib/jobViews';
import { addMonths, istMonthStart, buildReport, type DispatchRow, type StatusLogRow } from '@/lib/reports';
import { allPages } from '@/lib/api/allPages';
import { deptKeyOf } from '@/lib/identity';

type JobBits = {
  party: string; po_date: string | null; created_at: string;
  job_card_number: string | null; job_name: string | null; po_number: string; delivery_date: string | null;
};
// PostgREST returns a to-one embed as an object, but supabase-js types it loosely.
const one = <T,>(x: T | T[] | null): T | null => (Array.isArray(x) ? x[0] ?? null : x);

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!perms?.isSuperAdmin) {
    return NextResponse.json({ error: 'Only Admin can see reports' }, { status: 403 });
  }

  const param = new URL(request.url).searchParams.get('month') ?? '';
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(param) ? param : istToday().slice(0, 7);

  const admin = createAdminClient();
  const JOB = 'jobs(party, po_date, created_at, job_card_number, job_name, po_number, delivery_date)';

  // Paged (allPages): a single request stops at 1000 rows, and these run
  // oldest first — so the month being reported is what a cap would cut.
  // id last makes the order total, so no row is skipped or repeated.
  let dispatchRows, logRows;
  try {
    [dispatchRows, logRows] = await Promise.all([
      allPages((from, to) => admin
        .from('on_time_dispatch_log')
        .select(`job_id, dispatched_at, is_on_time, month_key, ${JOB}`)
        .gte('dispatched_at', istMonthStart(addMonths(month, -5)))
        .lt('dispatched_at', istMonthStart(addMonths(month, 1)))
        .order('dispatched_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)),
      allPages((from, to) => admin
        .from('job_status_logs')
        .select(`job_id, status, changed_at, qty_dispatched, ${JOB}`)
        .gte('changed_at', istMonthStart(addMonths(month, -1)))
        .order('changed_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)),
    ]);
  } catch (err) {
    console.error('[GET /api/reports]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  const dispatches: DispatchRow[] = [];
  for (const r of dispatchRows) {
    const j = one(r.jobs as JobBits | JobBits[] | null);
    if (!j) continue;
    dispatches.push({
      job_id: r.job_id, dispatched_at: r.dispatched_at, is_on_time: r.is_on_time, month_key: r.month_key,
      party: j.party, po_date: j.po_date, created_at: j.created_at,
    });
  }

  const logs: StatusLogRow[] = [];
  const events: {
    at: string; status: string; qty: number | null; job_card_number: string | null;
    party: string; job_name: string | null; po_number: string; delivery_date: string | null;
  }[] = [];
  for (const r of logRows) {
    const j = one(r.jobs as JobBits | JobBits[] | null);
    if (!j) continue;
    logs.push({ job_id: r.job_id, status: r.status, changed_at: r.changed_at, qty_dispatched: r.qty_dispatched, party: j.party });
    if ((r.status === 'Dispatched' || r.status === 'Partial Dispatch') && istToday(new Date(r.changed_at)).startsWith(month)) {
      events.push({
        at: r.changed_at, status: r.status, qty: r.qty_dispatched, job_card_number: j.job_card_number,
        party: j.party, job_name: j.job_name, po_number: j.po_number, delivery_date: j.delivery_date,
      });
    }
  }

  return NextResponse.json({ report: buildReport(month, dispatches, logs), dispatches: events });
}
