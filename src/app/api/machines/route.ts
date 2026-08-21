// src/app/api/machines/route.ts
// ============================================================
// GET  — the machine board: machines, their active queues (with job
//        info), the open jobs available to queue, and optionally the
//        printing history for a given ?date=YYYY-MM-DD.
// POST — add a machine (Production/Admin).
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireDept } from '@/lib/api/machineBoard';
import { canDeptManageMachineBoard } from '@/lib/constants/departments';

export async function GET(request: NextRequest) {
  const auth = await requireDept();
  if ('error' in auth) return auth.error;

  const admin = createAdminClient();
  const date  = request.nextUrl.searchParams.get('date');

  const [machinesRes, queueRes, jobsRes] = await Promise.all([
    admin.from('machines')
      .select('*')
      .eq('is_retired', false)
      .order('created_at'),
    admin.from('machine_queue_items')
      .select('*, jobs(po_number, job_name, party, label_qty)')
      .neq('status', 'done')
      .order('position'),
    // Only jobs whose job card is done are queueable. The !inner join is the
    // filter: a job with no 'Job Card Done' stamp has no matching row, so it
    // drops out of the list entirely rather than appearing and failing on add.
    // Prepress owns that stage — nothing reaches a press before they finish.
    admin.from('jobs')
      .select('id, po_number, job_name, party, label_qty, job_stage_timestamps!inner(stage)')
      .eq('is_closed', false)
      .not('status', 'in', '("Dispatched","PO Closed")')
      .eq('job_stage_timestamps.stage', 'Job Card Done')
      .order('created_at', { ascending: false }),
  ]);

  // Printing history for one calendar day (IST — the plant's local day)
  let history = null;
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const { data } = await admin.from('machine_queue_items')
      .select('*, jobs(po_number, job_name, party, label_qty), machines(name, location)')
      .eq('status', 'done')
      .gte('completed_at', `${date}T00:00:00+05:30`)
      .lt('completed_at', `${next.toISOString().slice(0, 10)}T00:00:00+05:30`)
      .order('completed_at');
    history = data ?? [];
  }

  return NextResponse.json({
    machines:       machinesRes.data ?? [],
    queue:          queueRes.data ?? [],
    available_jobs: jobsRes.data ?? [],
    history,
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireDept();
  if ('error' in auth) return auth.error;
  if (!canDeptManageMachineBoard(auth.perms)) {
    return NextResponse.json(
      { error: 'Only Production or Admin can add machines' },
      { status: 403 }
    );
  }

  const body = await request.json();
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return NextResponse.json({ error: 'Machine name is required' }, { status: 400 });
  }

  // Optional run rate (migration 010) — only sent through when it is a valid
  // positive whole number, so a blank field never becomes a bogus 0 or NaN.
  // Omitted entirely when unset, keeping inserts working before the migration.
  const rate = Number(body.labels_per_hour);
  const labelsPerHour = Number.isInteger(rate) && rate > 0 ? rate : null;

  const admin = createAdminClient();
  const { data: machine, error } = await admin
    .from('machines')
    .insert({
      name,
      location: typeof body.location === 'string' && body.location.trim()
        ? body.location.trim()
        : null,
      ...(labelsPerHour !== null ? { labels_per_hour: labelsPerHour } : {}),
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ machine });
}
