// src/app/api/dispatch-schedules/[id]/route.ts
// ============================================================
// PATCH /api/dispatch-schedules/[id]
// Marks a specific release row as dispatched.
// Called from the "Dispatch This Release" button in admin history panel.
// Only Dispatch and Admin departments can call this.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseDepartment } from '@/lib/constants/departments';
import { toMonthKey } from '@/lib/utils';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dept = parseDepartment(user.user_metadata?.department);
  if (!dept || !['Dispatch', 'Admin'].includes(dept)) {
    return NextResponse.json({ error: 'Only Dispatch or Admin can dispatch releases' }, { status: 403 });
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

  const now = new Date().toISOString();

  // Update schedule row
  const { data: updatedSchedule, error: updateError } = await admin
    .from('dispatch_schedules')
    .update({
      actual_qty:  actual_qty,
      actual_date: actual_date ?? now,
      status:      'Dispatched',
    })
    .eq('id', id)
    .select()
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Update parent job's dispatched_qty
  const { data: job } = await admin
    .from('jobs')
    .select('dispatched_qty, label_qty, delivery_date')
    .eq('id', schedule.job_id)
    .single();

  if (job) {
    const newDispatchedQty = (job.dispatched_qty ?? 0) + actual_qty;
    await admin
      .from('jobs')
      .update({ dispatched_qty: newDispatchedQty })
      .eq('id', schedule.job_id);

    // Write status log entry
    await admin.from('job_status_logs').insert({
      job_id:          schedule.job_id,
      status:          'Partial Dispatch',
      changed_by_dept: dept,
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
