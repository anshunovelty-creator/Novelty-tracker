// src/app/api/machines/[id]/queue/route.ts
// ============================================================
// POST — queue a job on this machine (Production/Admin), appended at the
// end of the sequence, with optional estimated start/finish times.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireDept } from '@/lib/api/machineBoard';
import { canDeptManageMachineBoard } from '@/lib/constants/departments';
import { estimateFinishIso } from '@/lib/machineSpeed';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id: machineId } = await params;
  const auth = await requireDept();
  if ('error' in auth) return auth.error;
  if (!canDeptManageMachineBoard(auth.perms)) {
    return NextResponse.json(
      { error: 'Only Production or Admin can queue jobs on machines' },
      { status: 403 }
    );
  }

  const body = await request.json();
  const jobId = typeof body.job_id === 'string' ? body.job_id : '';
  if (!jobId) {
    return NextResponse.json({ error: 'job_id is required' }, { status: 400 });
  }

  for (const field of ['est_start_at', 'est_end_at'] as const) {
    if (body[field] != null && isNaN(Date.parse(body[field]))) {
      return NextResponse.json({ error: `${field} is not a valid date` }, { status: 400 });
    }
  }

  const admin = createAdminClient();

  // select('*') rather than naming labels_per_hour: that column arrives with
  // migration 010, and naming a missing column would fail the whole request.
  // Absent column simply means no automatic estimate.
  const { data: machine } = await admin
    .from('machines')
    .select('*')
    .eq('id', machineId)
    .maybeSingle();
  if (!machine || machine.is_retired) {
    return NextResponse.json({ error: 'Machine not found' }, { status: 404 });
  }

  const { data: job } = await admin
    .from('jobs')
    .select('id, is_closed, po_number, label_qty')
    .eq('id', jobId)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  if (job.is_closed) {
    return NextResponse.json({ error: 'This PO is closed' }, { status: 400 });
  }

  // Nothing reaches a press before Prepress finishes the job card. The picker
  // already hides these jobs; this is what holds when the board is working
  // from stale data, or when a job card is un-stamped after it was queued.
  const { data: jobCard } = await admin
    .from('job_stage_timestamps')
    .select('id')
    .eq('job_id', jobId)
    .eq('stage', 'Job Card Done')
    .maybeSingle();

  if (!jobCard) {
    return NextResponse.json(
      { error: `Job card is pending for ${job.po_number} — Prepress must complete "Job Card Done" before it can be queued` },
      { status: 400 }
    );
  }

  // A job runs on one machine at a time, so check every machine — not just this
  // one. The picker already hides jobs queued elsewhere; this is what holds when
  // two people queue the same PO at once, or a screen works from stale data.
  // limit(1) rather than maybeSingle(): if any job predates this rule and sits on
  // two machines, maybeSingle() would error instead of reporting the clash.
  const { data: dups } = await admin
    .from('machine_queue_items')
    .select('id, machine_id, machines(name)')
    .eq('job_id', jobId)
    .neq('status', 'done')
    .limit(1);

  const dup = dups?.[0];
  if (dup) {
    const where = dup.machine_id === machineId
      ? "this machine's queue"
      : `${(dup.machines as { name?: string } | null)?.name ?? 'another machine'}'s queue`;
    return NextResponse.json(
      { error: `${job.po_number} is already in ${where}` },
      { status: 409 }
    );
  }

  // Append at the end of the active sequence
  const { data: last } = await admin
    .from('machine_queue_items')
    .select('position')
    .eq('machine_id', machineId)
    .neq('status', 'done')
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Work out the finish from the machine's rate when Production leaves it
  // blank. Anything they typed wins; a machine with no rate, or a job with no
  // quantity, just keeps the blank.
  const estStart = body.est_start_at ?? null;
  const estEnd   = body.est_end_at
    ?? estimateFinishIso(estStart, job.label_qty, machine.labels_per_hour);

  const { data: item, error } = await admin
    .from('machine_queue_items')
    .insert({
      machine_id:   machineId,
      job_id:       jobId,
      position:     (last?.position ?? 0) + 1,
      est_start_at: estStart,
      est_end_at:   estEnd,
      created_by:   auth.perms.key,
    })
    .select('*, jobs(po_number, job_name, party, label_qty)')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ item });
}
