// src/app/api/machines/[id]/queue/route.ts
// ============================================================
// POST — queue a job on this machine (Production/Admin), appended at the
// end of the sequence, with optional estimated start/finish times.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { MACHINE_MANAGERS, requireDept } from '@/lib/api/machineBoard';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id: machineId } = await params;
  const auth = await requireDept();
  if ('error' in auth) return auth.error;
  if (!MACHINE_MANAGERS.includes(auth.dept)) {
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

  const { data: machine } = await admin
    .from('machines')
    .select('id, is_retired')
    .eq('id', machineId)
    .maybeSingle();
  if (!machine || machine.is_retired) {
    return NextResponse.json({ error: 'Machine not found' }, { status: 404 });
  }

  const { data: job } = await admin
    .from('jobs')
    .select('id, is_closed, po_number')
    .eq('id', jobId)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  if (job.is_closed) {
    return NextResponse.json({ error: 'This PO is closed' }, { status: 400 });
  }

  // Already waiting or printing on this machine?
  const { data: dup } = await admin
    .from('machine_queue_items')
    .select('id')
    .eq('machine_id', machineId)
    .eq('job_id', jobId)
    .neq('status', 'done')
    .maybeSingle();
  if (dup) {
    return NextResponse.json(
      { error: `${job.po_number} is already in this machine's queue` },
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

  const { data: item, error } = await admin
    .from('machine_queue_items')
    .insert({
      machine_id:   machineId,
      job_id:       jobId,
      position:     (last?.position ?? 0) + 1,
      est_start_at: body.est_start_at ?? null,
      est_end_at:   body.est_end_at ?? null,
      created_by:   auth.dept,
    })
    .select('*, jobs(po_number, job_name, party, label_qty)')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ item });
}
