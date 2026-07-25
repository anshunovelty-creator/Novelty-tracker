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
import { MACHINE_MANAGERS, requireDept } from '@/lib/api/machineBoard';
import { advanceJobStageFromMachine } from '@/lib/api/advanceJobStage';
import type { MachineDrivenStage, StageSyncResult } from '@/lib/api/advanceJobStage';

type Params = { params: Promise<{ id: string; itemId: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id: machineId, itemId } = await params;
  const auth = await requireDept();
  if ('error' in auth) return auth.error;
  if (!MACHINE_MANAGERS.includes(auth.dept)) {
    return NextResponse.json(
      { error: 'Only Production or Admin can update machine queues' },
      { status: 403 }
    );
  }

  const body  = await request.json();
  const admin = createAdminClient();

  const { data: item } = await admin
    .from('machine_queue_items')
    .select('*, machines(name)')
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
          auth.dept,
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
  if (!MACHINE_MANAGERS.includes(auth.dept)) {
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
