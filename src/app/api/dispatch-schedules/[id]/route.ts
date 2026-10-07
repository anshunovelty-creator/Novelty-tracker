// src/app/api/dispatch-schedules/[id]/route.ts
// ============================================================
// PATCH /api/dispatch-schedules/[id]
// ADMIN OVERRIDE: force-marks a release as dispatched without a
// production run — for corrections or releases handled outside the
// system. The normal path is a print run advancing through the per-run
// pipeline (print-runs/[runId]/stage), which completes the schedule
// automatically. Blocked while a linked run is still in production.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions } from '@/lib/constants/departments';
import { toMonthKey } from '@/lib/utils';
import { deptKeyOf } from '@/lib/identity';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Stricter than the general Dispatch+Admin delivery-date permission —
  // force-dispatching without a production run skips normal validation, so
  // it stays a bare super-admin-only override, not an independently
  // grantable feature.
  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!perms?.isSuperAdmin) {
    return NextResponse.json(
      { error: 'Only Admin can override-dispatch a release — advance its production run instead' },
      { status: 403 }
    );
  }

  const body = await request.json();
  const { actual_qty, actual_date } = body;

  if (!actual_qty || actual_qty <= 0) {
    return NextResponse.json({ error: 'actual_qty is required and must be > 0' }, { status: 400 });
  }

  const admin = createAdminClient();

  // Fetch the schedule row to get job_id and planned_qty
  const { data: schedule, error: fetchError } = await admin
    .from('dispatch_schedules')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError || !schedule) {
    return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
  }

  if (schedule.status === 'Dispatched') {
    return NextResponse.json({ error: 'This release is already dispatched' }, { status: 400 });
  }

  // A release with an active production run must be dispatched through the
  // run pipeline — otherwise the quantity would be counted twice.
  const { data: linkedRun } = await admin
    .from('print_runs')
    .select('id, run_number, status')
    .eq('schedule_id', id)
    .maybeSingle();

  if (linkedRun && linkedRun.status !== 'dispatched') {
    return NextResponse.json(
      { error: `Run #${linkedRun.run_number} is in production for this release — advance the run to Dispatched instead` },
      { status: 409 }
    );
  }

  const now = new Date().toISOString();

  // Claim the release: only a schedule not yet dispatched moves, so two
  // people pressing Dispatch on it at once can't both count it.
  const { data: updatedSchedule, error: updateError } = await admin
    .from('dispatch_schedules')
    .update({
      actual_qty:  actual_qty,
      actual_date: actual_date ?? now,
      status:      'Dispatched',
    })
    .eq('id', id)
    .neq('status', 'Dispatched')
    .select()
    .maybeSingle();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }
  if (!updatedSchedule) {
    return NextResponse.json({ error: 'This release is already dispatched' }, { status: 409 });
  }

  // Add to the job's running totals in one statement (add_job_dispatched,
  // migration 073) — no read-add-write, so a dispatch recorded at the same
  // moment can't be lost, and the database refuses going past the order.
  // Refused: put the release back as it was, so nothing half-counts.
  const { data: totals, error: addError } = await admin
    .rpc('add_job_dispatched', { p_job_id: schedule.job_id, p_qty: actual_qty })
    .single<{ dispatched_qty: number; total_qty_dispatched: number; label_qty: number | null }>();

  if (addError || !totals) {
    await admin
      .from('dispatch_schedules')
      .update({ actual_qty: schedule.actual_qty, actual_date: schedule.actual_date, status: schedule.status })
      .eq('id', id);
    const over = addError?.message.includes('OVER_DISPATCH');
    return NextResponse.json(
      { error: over ? `That would dispatch more than the job's order — ${actual_qty} is too many` : (addError?.message ?? 'Could not update the job') },
      { status: over ? 409 : 500 },
    );
  }

  const { data: job } = await admin
    .from('jobs')
    .select('label_qty, delivery_date')
    .eq('id', schedule.job_id)
    .single();

  if (job) {
    const newDispatchedQty = totals.dispatched_qty;

    // Write status log entry
    await admin.from('job_status_logs').insert({
      job_id:          schedule.job_id,
      status:          'Partial Dispatch',
      changed_by_dept: perms.key,
      changed_at:      now,
      qty_dispatched:  actual_qty,
    });

    // Write on-time log if all quantities are now dispatched
    const allDispatched = newDispatchedQty >= (job.label_qty ?? 0);
    if (allDispatched && job.delivery_date) {
      const dispatchedAt   = new Date(actual_date ?? now);
      const deliveryDate   = new Date(job.delivery_date);
      const isOnTime       = dispatchedAt <= deliveryDate;
      await admin.from('on_time_dispatch_log').insert({
        job_id:        schedule.job_id,
        dispatched_at: dispatchedAt.toISOString(),
        delivery_date: job.delivery_date,
        is_on_time:    isOnTime,
        month_key:     toMonthKey(dispatchedAt),
      });
    }
  }

  return NextResponse.json({ schedule: updatedSchedule });
}
