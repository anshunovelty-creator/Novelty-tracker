// src/app/api/jobs/[id]/status/route.ts
// ============================================================
// POST /api/jobs/[id]/status
//
// The core business logic route. Every status change goes through here.
// Responsibilities:
//   1. Authenticate + validate department permission for this stage
//   2. Check sequential prerequisite (unless override = true)
//   3. Handle Repeat job stage-skip rules
//   4. Update jobs.status (and halt_remark / qc_remark if applicable)
//   5. Write job_stage_timestamps (mark stage as completed)
//   6. Write job_status_logs (permanent audit entry)
//   7. Handle dispatch qty (Partial Dispatch / Dispatched)
//   8. Write on_time_dispatch_log if status = Dispatched
//   9. Close PO if status = PO Closed
//  10. Trigger notifications (email + WhatsApp) for qualifying stages
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseDepartment, canDeptSetStage } from '@/lib/constants/departments';
import { getPrerequisite, isStageSkipped, NOTIFICATION_TRIGGER_STAGES } from '@/lib/constants/stages';
import { toMonthKey } from '@/lib/utils';
import type { Stage } from '@/lib/constants/stages';
import type { StatusChangePayload } from '@/lib/types';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  // ── 1. Auth ───────────────────────────────────────────────
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dept = parseDepartment(user.user_metadata?.department);
  if (!dept) {
    return NextResponse.json({ error: 'Invalid department in token' }, { status: 403 });
  }

  const body: StatusChangePayload = await request.json();
  const { new_status, remark, qty_dispatched, override_prerequisite } = body;

  if (!new_status) {
    return NextResponse.json({ error: 'new_status is required' }, { status: 400 });
  }

  // ── 2. Department permission check ────────────────────────
  if (!canDeptSetStage(dept, new_status)) {
    return NextResponse.json(
      { error: `${dept} department cannot set status to "${new_status}"` },
      { status: 403 }
    );
  }

  const admin = createAdminClient();

  // ── 3. Fetch current job ──────────────────────────────────
  const { data: job, error: jobError } = await admin
    .from('jobs')
    .select('*')
    .eq('id', id)
    .single();

  if (jobError || !job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  if (job.is_closed) {
    return NextResponse.json({ error: 'Cannot update a closed PO' }, { status: 400 });
  }

  const jobType = job.job_type as 'New' | 'Repeat' | 'Artwork Changed';

  // ── 4. Check Repeat job stage-skip rules ─────────────────
  if (isStageSkipped(new_status, jobType)) {
    return NextResponse.json(
      { error: `Stage "${new_status}" is not applicable for ${jobType} jobs` },
      { status: 400 }
    );
  }

  // ── 5. Prerequisite check (unless On Hold or override) ───
  if (new_status !== 'On Hold' && !override_prerequisite) {
    const prereq = getPrerequisite(new_status, jobType);
    if (prereq) {
      // Check if prereq stage has a timestamp
      const { data: prereqTimestamp } = await admin
        .from('job_stage_timestamps')
        .select('id')
        .eq('job_id', id)
        .eq('stage', prereq)
        .maybeSingle();

      if (!prereqTimestamp) {
        // Return the missing stage so the frontend can show the warning modal
        return NextResponse.json(
          {
            error:         'PREREQUISITE_MISSING',
            missing_stage: prereq,
            target_stage:  new_status,
          },
          { status: 409 }
        );
      }
    }
  }

  // ── 6. Validate dispatch-specific rules ──────────────────
  if (new_status === 'Partial Dispatch') {
    if (!qty_dispatched || qty_dispatched <= 0) {
      return NextResponse.json(
        { error: 'qty_dispatched is required for Partial Dispatch' },
        { status: 400 }
      );
    }
    if (job.label_qty && qty_dispatched > (job.label_qty - job.dispatched_qty)) {
      return NextResponse.json(
        { error: 'qty_dispatched exceeds remaining quantity' },
        { status: 400 }
      );
    }
  }

  if (new_status === 'On Hold' && !remark?.trim()) {
    return NextResponse.json(
      { error: 'halt_remark is required when placing On Hold' },
      { status: 400 }
    );
  }

  // ── 7. Build job update payload ───────────────────────────
  const now = new Date().toISOString();
  const jobUpdate: Record<string, unknown> = {
    status: new_status,
  };

  if (new_status === 'On Hold') {
    jobUpdate.halt_remark = remark?.trim() ?? null;
  } else if (new_status === 'Quality Check') {
    jobUpdate.qc_remark = remark?.trim() ?? null;
  }

  if (new_status === 'Partial Dispatch' && qty_dispatched) {
    jobUpdate.dispatched_qty = (job.dispatched_qty ?? 0) + qty_dispatched;
    // remaining_qty is auto-calculated by DB trigger
  }

  if (new_status === 'Dispatched') {
    // Full dispatch: mark all remaining as dispatched
    jobUpdate.dispatched_qty = job.label_qty ?? job.dispatched_qty;
    // remaining_qty → 0 via trigger
  }

  if (new_status === 'PO Closed') {
    if (dept !== 'Admin') {
      return NextResponse.json({ error: 'Only Admin can close a PO' }, { status: 403 });
    }
    jobUpdate.is_closed = true;
  }

  // ── 8. Execute all DB writes in sequence ──────────────────
  // (Supabase JS doesn't support true transactions from the edge —
  //  we write in dependency order; if a later write fails, the job
  //  is still updated but the log/timestamp may be missing.
  //  For production-critical atomicity, wrap these in a Postgres function.)

  // Update job
  const { data: updatedJob, error: updateError } = await admin
    .from('jobs')
    .update(jobUpdate)
    .eq('id', id)
    .select()
    .single();

  if (updateError) {
    console.error('[POST status] update job:', updateError);
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Write stage timestamp (upsert — safe if stage was already timestamped)
  await admin
    .from('job_stage_timestamps')
    .upsert(
      { job_id: id, stage: new_status, completed_at: now },
      { onConflict: 'job_id,stage' }
    );

  // Write status log
  await admin
    .from('job_status_logs')
    .insert({
      job_id:          id,
      status:          new_status,
      changed_by_dept: dept,
      changed_at:      now,
      remark:          new_status === 'On Hold' || new_status === 'Quality Check'
                         ? (remark?.trim() ?? null)
                         : null,
      qty_dispatched:  (new_status === 'Partial Dispatch' || new_status === 'Dispatched')
                         ? (qty_dispatched ?? updatedJob.dispatched_qty)
                         : null,
    });

  // Write on-time dispatch log if fully dispatched
  if (new_status === 'Dispatched') {
    const dispatchedAt = new Date();
    const deliveryDate = job.delivery_date ? new Date(job.delivery_date) : null;
    const isOnTime = deliveryDate
      ? dispatchedAt <= deliveryDate
      : null;

    await admin
      .from('on_time_dispatch_log')
      .insert({
        job_id:        id,
        dispatched_at: dispatchedAt.toISOString(),
        delivery_date: job.delivery_date ?? null,
        is_on_time:    isOnTime,
        month_key:     toMonthKey(dispatchedAt),
      });
  }

  // ── 9. Fire notifications (non-blocking — don't await, don't fail request) ──
  if (NOTIFICATION_TRIGGER_STAGES.includes(new_status)) {
    const notifyPayload = {
      job_id:     id,
      job_name:   job.job_name,
      po_number:  job.po_number,
      party:      job.party,
      status:     new_status,
      remark:     remark?.trim() ?? null,
      qty:        qty_dispatched ?? updatedJob.dispatched_qty,
    };

    // Fire-and-forget — failures are logged server-side but don't block response
    Promise.all([
      fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notifications/email`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(notifyPayload),
      }),
      fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notifications/whatsapp`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(notifyPayload),
      }),
    ]).catch((err) => {
      console.error('[POST status] notification error (non-fatal):', err);
    });
  }

  return NextResponse.json({ job: updatedJob });
}
