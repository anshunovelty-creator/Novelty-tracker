// src/app/api/jobs/[id]/schedules/route.ts
// ============================================================
// POST /api/jobs/[id]/schedules — add the NEXT scheduled release.
//
// Scheduled-release jobs rarely know all their release dates upfront —
// the client confirms them one at a time. This endpoint lets Admin add
// the next release (planned date + qty + notes) whenever it becomes
// known. release_number is auto-assigned. Production later starts a
// print run against the schedule ("Start Production" in the admin
// panel), which carries it through the full per-run pipeline.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseDepartment } from '@/lib/constants/departments';
import type { DispatchSchedule } from '@/lib/types';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dept = parseDepartment(user.user_metadata?.department);
  if (dept !== 'Admin') {
    return NextResponse.json({ error: 'Only Admin can add scheduled releases' }, { status: 403 });
  }

  const body: {
    planned_qty?:  number;
    planned_date?: string;
    notes?:        string;
  } = await request.json();

  const plannedQty  = body.planned_qty;
  const plannedDate = body.planned_date;

  if (!plannedQty || plannedQty <= 0) {
    return NextResponse.json({ error: 'planned_qty must be a positive number' }, { status: 400 });
  }
  if (!plannedDate || isNaN(Date.parse(plannedDate))) {
    return NextResponse.json({ error: 'planned_date must be a valid date (YYYY-MM-DD)' }, { status: 400 });
  }

  const admin = createAdminClient();

  // ── Fetch job + validate ──
  const { data: job, error: jobError } = await admin
    .from('jobs')
    .select('id, label_qty, is_closed, is_scheduled_release')
    .eq('id', id)
    .single();

  if (jobError || !job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }
  if (job.is_closed) {
    return NextResponse.json({ error: 'Cannot add releases to a closed PO' }, { status: 400 });
  }

  // ── Quantity guard: planned + dispatched must fit inside label_qty ──
  const { data: existing } = await admin
    .from('dispatch_schedules')
    .select('release_number, planned_qty, actual_qty, status')
    .eq('job_id', id);

  const schedules = (existing ?? []) as Pick<
    DispatchSchedule, 'release_number' | 'planned_qty' | 'actual_qty' | 'status'
  >[];

  if (job.label_qty) {
    const committed = schedules.reduce(
      (sum, s) => sum + (s.status === 'Dispatched' ? (s.actual_qty ?? s.planned_qty) : s.planned_qty),
      0
    );
    if (committed + plannedQty > job.label_qty) {
      return NextResponse.json(
        {
          error:
            `planned_qty (${plannedQty}) exceeds the unscheduled quantity — ` +
            `${committed} of ${job.label_qty} is already scheduled or dispatched`,
        },
        { status: 400 }
      );
    }
  }

  const nextReleaseNumber =
    schedules.reduce((max, s) => Math.max(max, s.release_number), 0) + 1;

  // ── Insert the schedule ──
  const { data: schedule, error: insertError } = await admin
    .from('dispatch_schedules')
    .insert({
      job_id:         id,
      release_number: nextReleaseNumber,
      planned_qty:    plannedQty,
      planned_date:   plannedDate,
      status:         'Pending',
      notes:          body.notes?.trim() || null,
    })
    .select()
    .single();

  if (insertError) {
    console.error('[POST schedules] insert:', insertError);
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // A job gains scheduled-release behaviour the moment it has a schedule.
  if (!job.is_scheduled_release) {
    await admin.from('jobs').update({ is_scheduled_release: true }).eq('id', id);
  }

  return NextResponse.json({ schedule }, { status: 201 });
}
