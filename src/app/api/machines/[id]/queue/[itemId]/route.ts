// src/app/api/machines/[id]/queue/[itemId]/route.ts
// ============================================================
// PATCH  — one queue item (Production/Admin):
//   action 'start'     → status printing, started_at stamped now
//   action 'complete'  → status done, completed_at stamped now (history)
//   action 'move_up' / 'move_down' → swap sequence with neighbour
//   est_start_at / est_end_at      → update the estimates
// DELETE — remove a mistakenly queued item (done items are history and
//          cannot be removed).
//
// Start and Complete also carry the job's pipeline stage forward
// (→ "In Printing" / → "Slitting") so Production records the work once rather
// than on both the machine board and the job. The stage sync never fails the
// machine action; the outcome comes back as `stage_sync` for the UI to report.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireDept } from '@/lib/api/machineBoard';
import { canDeptManageMachineBoard } from '@/lib/constants/departments';
import { advanceJobStageFromMachine } from '@/lib/api/advanceJobStage';
import { estimateFinishIso } from '@/lib/machineSpeed';
import type { MachineDrivenStage, StageSyncResult } from '@/lib/api/advanceJobStage';

type Params = { params: Promise<{ id: string; itemId: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id: machineId, itemId } = await params;
  const auth = await requireDept();
  if ('error' in auth) return auth.error;
  if (!canDeptManageMachineBoard(auth.perms)) {
    return NextResponse.json(
      { error: 'Only Production or Admin can update machine queues' },
      { status: 403 }
    );
  }

  const body  = await request.json();
  const admin = createAdminClient();

  // machines(*) rather than machines(name): labels_per_hour arrives with
  // migration 010, and naming a column that does not exist yet would fail the
  // request. Its absence just means no automatic finish estimate.
  const { data: item } = await admin
    .from('machine_queue_items')
    .select('*, machines(*), jobs(label_qty)')
    .eq('id', itemId)
    .eq('machine_id', machineId)
    .maybeSingle();
  if (!item) {
    return NextResponse.json({ error: 'Queue item not found' }, { status: 404 });
  }

  const now = new Date().toISOString();
  const update: Record<string, unknown> = {};
  // Set on start/complete: the stage the job should be carried to once the
  // queue item is successfully updated.
  let stageTarget: MachineDrivenStage | null = null;

  if (body.action === 'start') {
    if (item.status !== 'queued') {
      return NextResponse.json({ error: 'Only a queued job can be started' }, { status: 409 });
    }
    // One job prints at a time per machine
    const { data: printing } = await admin
      .from('machine_queue_items')
      .select('id')
      .eq('machine_id', machineId)
      .eq('status', 'printing')
      .maybeSingle();
    if (printing) {
      return NextResponse.json(
        { error: 'Another job is already printing on this machine — complete it first' },
        { status: 409 }
      );
    }
    update.status     = 'printing';
    update.started_at = now;
    stageTarget       = 'In Printing';

    // No finish estimate yet? Derive one from the machine's rate and the actual
    // start, so the room display can show progress against something. An
    // estimate already on the item is left alone.
    if (!item.est_end_at) {
      const machine = item.machines as { labels_per_hour?: number | null } | null;
      const job     = item.jobs     as { label_qty?: number | null } | null;
      const derived = estimateFinishIso(now, job?.label_qty, machine?.labels_per_hour);
      if (derived) {
        update.est_end_at = derived;
        // Anchor the estimate window too. The utilisation report measures
        // accuracy as est_start→est_end against started_at→completed_at, so an
        // end with no start would leave that comparison permanently empty.
        if (!item.est_start_at) update.est_start_at = now;
      }
    }
  } else if (body.action === 'complete') {
    if (item.status !== 'printing') {
      return NextResponse.json({ error: 'Only the printing job can be completed' }, { status: 409 });
    }
    update.status       = 'done';
    update.completed_at = now;
    stageTarget         = 'Slitting';
  } else if (body.action === 'move_up' || body.action === 'move_down') {
    if (item.status !== 'queued') {
      return NextResponse.json({ error: 'Only queued jobs can be reordered' }, { status: 409 });
    }
    const { data: siblings } = await admin
      .from('machine_queue_items')
      .select('id, position')
      .eq('machine_id', machineId)
      .eq('status', 'queued')
      .order('position');
    const list = siblings ?? [];
    const idx  = list.findIndex((s) => s.id === itemId);
    const swap = body.action === 'move_up' ? list[idx - 1] : list[idx + 1];
    if (!swap) {
      return NextResponse.json({ item });   // already at the edge — no-op
    }
    await admin.from('machine_queue_items').update({ position: swap.position }).eq('id', itemId);
    await admin.from('machine_queue_items').update({ position: item.position }).eq('id', swap.id);
  } else if (body.action) {
    return NextResponse.json({ error: `Unknown action "${body.action}"` }, { status: 400 });
  }

  // Estimate updates (only when no lifecycle action was sent)
  for (const field of ['est_start_at', 'est_end_at'] as const) {
    if (field in body && body.action == null) {
      if (body[field] != null && isNaN(Date.parse(body[field]))) {
        return NextResponse.json({ error: `${field} is not a valid date` }, { status: 400 });
      }
      update[field] = body[field] ?? null;
    }
  }

  if (Object.keys(update).length > 0) {
    const { data: updated, error } = await admin
      .from('machine_queue_items')
      .update(update)
      .eq('id', itemId)
      .select('*, jobs(po_number, job_name, party, label_qty)')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Carry the job's stage forward. Deliberately after the queue item is
    // committed and never able to fail this request: the button press records
    // printing that physically happened, so it must stick even when the stage
    // cannot move (prerequisite not reached, closed PO, scheduled release).
    let stageSync: StageSyncResult | undefined;
    if (stageTarget) {
      const machineName = (item.machines as { name?: string } | null)?.name ?? 'machine';
      const label = stageTarget === 'In Printing' ? 'Start' : 'Complete';
      try {
        stageSync = await advanceJobStageFromMachine(
          item.job_id,
          stageTarget,
          auth.perms,
          `${machineName} · ${label}`
        );
      } catch (err) {
        console.error('[PATCH queue item] stage sync failed (non-fatal):', err);
        stageSync = { advanced: false, reason: 'the stage could not be updated' };
      }
    }

    return NextResponse.json({ item: updated, stage_sync: stageSync });
  }

  const { data: fresh } = await admin
    .from('machine_queue_items')
    .select('*, jobs(po_number, job_name, party, label_qty)')
    .eq('id', itemId)
    .single();
  return NextResponse.json({ item: fresh });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id: machineId, itemId } = await params;
  const auth = await requireDept();
  if ('error' in auth) return auth.error;
  if (!canDeptManageMachineBoard(auth.perms)) {
    return NextResponse.json(
      { error: 'Only Production or Admin can update machine queues' },
      { status: 403 }
    );
  }

  const admin = createAdminClient();
  const { data: item } = await admin
    .from('machine_queue_items')
    .select('id, status')
    .eq('id', itemId)
    .eq('machine_id', machineId)
    .maybeSingle();
  if (!item) {
    return NextResponse.json({ error: 'Queue item not found' }, { status: 404 });
  }
  if (item.status === 'done') {
    return NextResponse.json(
      { error: 'Completed items are printing history and cannot be removed' },
      { status: 400 }
    );
  }

  const { error } = await admin.from('machine_queue_items').delete().eq('id', itemId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
