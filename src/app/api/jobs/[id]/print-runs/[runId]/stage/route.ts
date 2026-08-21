// src/app/api/jobs/[id]/print-runs/[runId]/stage/route.ts
// ============================================================
// POST — advance a print run through the per-run pipeline
// (see constants/runStages.ts), strictly sequential.
//
// On Dispatched:
//   - print_run.status = 'dispatched', dispatched_at = now
//   - linked dispatch_schedules row (scheduled releases) is completed
//   - jobs.dispatched_qty AND jobs.total_qty_dispatched += qty_this_run
//     (single source of dispatch bookkeeping — both totals stay in sync)
//   - a 'Partial Dispatch' status log is written; on-time log when the
//     job completes
// Every change is appended to print_run_stage_logs.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptSetRunStage } from '@/lib/constants/departments';
import { RUN_STAGES } from '@/lib/constants/runStages';
import { toMonthKey } from '@/lib/utils';
import type { PrintRunStage } from '@/lib/types';

type Params = { params: Promise<{ id: string; runId: string }> };

const RUN_STAGE_ORDER: readonly PrintRunStage[] = RUN_STAGES;

export async function POST(request: NextRequest, { params }: Params) {
  const { id, runId } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!perms) return NextResponse.json({ error: 'Invalid department in token' }, { status: 403 });

  const body: { new_stage?: PrintRunStage; notes?: string; qc_remark?: string } = await request.json();
  const newStage = body.new_stage;
  const qcRemark = body.qc_remark?.trim() || null;

  if (!newStage || !RUN_STAGE_ORDER.includes(newStage)) {
    return NextResponse.json(
      { error: `new_stage must be one of: ${RUN_STAGE_ORDER.join(', ')}` },
      { status: 400 }
    );
  }

  // ── Department permission ──
  if (!canDeptSetRunStage(perms, newStage)) {
    return NextResponse.json(
      { error: `${perms.key} department cannot set run stage to "${newStage}"` },
      { status: 403 }
    );
  }

  const admin = createAdminClient();

  // ── Fetch run + verify it belongs to this job ──
  const { data: run, error: runError } = await admin
    .from('print_runs')
    .select('*')
    .eq('id', runId)
    .eq('job_id', id)
    .single();

  if (runError || !run) {
    return NextResponse.json({ error: 'Print run not found for this job' }, { status: 404 });
  }
  if (run.status === 'dispatched') {
    return NextResponse.json({ error: 'This run is already dispatched' }, { status: 400 });
  }

  // ── Strict sequential progression ──
  const currentIdx = RUN_STAGE_ORDER.indexOf(run.current_stage as PrintRunStage);
  const targetIdx  = RUN_STAGE_ORDER.indexOf(newStage);

  if (targetIdx !== currentIdx + 1) {
    return NextResponse.json(
      {
        error: `Invalid progression: "${run.current_stage}" → "${newStage}". ` +
               `Next stage must be "${RUN_STAGE_ORDER[currentIdx + 1] ?? 'none — run is complete'}".`,
      },
      { status: 409 }
    );
  }

  const now = new Date().toISOString();

  // ── Update the run ──
  const runUpdate: Record<string, unknown> = { current_stage: newStage };
  if (newStage === 'Dispatched') {
    runUpdate.status        = 'dispatched';
    runUpdate.dispatched_at = now;
  }
  // Per-release QC remark — recorded when QC signs the run off (leaving QC).
  if (qcRemark) {
    runUpdate.qc_remark = qcRemark;
  }

  const { data: updatedRun, error: updateError } = await admin
    .from('print_runs')
    .update(runUpdate)
    .eq('id', runId)
    .select()
    .single();

  if (updateError) {
    console.error('[POST print-run stage] update run:', updateError);
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // ── On dispatch: complete the linked schedule + job bookkeeping ──
  if (newStage === 'Dispatched') {
    // If Admin already force-dispatched the linked release (override path),
    // its quantity is already counted — only finish the run itself.
    let alreadyCounted = false;

    if (run.schedule_id) {
      const { data: schedule } = await admin
        .from('dispatch_schedules')
        .select('id, status')
        .eq('id', run.schedule_id)
        .single();

      if (schedule?.status === 'Dispatched') {
        alreadyCounted = true;
      } else if (schedule) {
        await admin
          .from('dispatch_schedules')
          .update({ actual_qty: run.qty_this_run, actual_date: now, status: 'Dispatched' })
          .eq('id', schedule.id);
      }
    }

    if (!alreadyCounted) {
      const { data: job } = await admin
        .from('jobs')
        .select('dispatched_qty, total_qty_dispatched, label_qty, delivery_date')
        .eq('id', id)
        .single();

      if (job) {
        // Both totals move together — the schedule path and the run path
        // used to update different fields, which made the portals disagree.
        const newDispatchedQty = (job.dispatched_qty ?? 0) + run.qty_this_run;
        await admin
          .from('jobs')
          .update({
            dispatched_qty:       newDispatchedQty,
            total_qty_dispatched: (job.total_qty_dispatched ?? 0) + run.qty_this_run,
          })
          .eq('id', id);

        await admin.from('job_status_logs').insert({
          job_id:          id,
          status:          'Partial Dispatch',
          changed_by_dept: perms.key,
          changed_at:      now,
          qty_dispatched:  run.qty_this_run,
        });

        const allDispatched = newDispatchedQty >= (job.label_qty ?? 0);
        if (allDispatched && job.delivery_date) {
          const dispatchedAt = new Date(now);
          await admin.from('on_time_dispatch_log').insert({
            job_id:        id,
            dispatched_at: dispatchedAt.toISOString(),
            delivery_date: job.delivery_date,
            is_on_time:    dispatchedAt <= new Date(job.delivery_date),
            month_key:     toMonthKey(dispatchedAt),
          });
        }
      }
    }
  }

  // ── Audit log ──
  await admin
    .from('print_run_stage_logs')
    .insert({
      print_run_id: runId,
      stage:        newStage,
      changed_by:   user.id,
      notes:        body.notes?.trim() || (qcRemark ? `[QC] ${qcRemark}` : null),
    });

  return NextResponse.json({ print_run: updatedRun });
}
