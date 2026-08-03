// src/app/api/jobs/route.ts
// ============================================================
// GET  /api/jobs  — list all active jobs (sorted by delivery_date ASC)
// POST /api/jobs  — create a new job + optional dispatch schedule rows
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseDepartment } from '@/lib/constants/departments';
import { getVisibleStages } from '@/lib/constants/stages';
import type { AddJobFormData } from '@/lib/types';

// ── GET ───────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  // Verify authenticated
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status    = searchParams.get('status');
  const urgent    = searchParams.get('urgent');
  const search    = searchParams.get('search');
  const closed    = searchParams.get('closed') === 'true';

  let query = supabase
    .from('jobs')
    .select('*, job_stage_timestamps(stage), printing_units(id, name, printing_method)')
    .eq('is_closed', closed)
    .order('delivery_date', { ascending: true, nullsFirst: false });

  if (status)  query = query.eq('status', status);
  if (urgent === 'true')  query = query.eq('urgent', true);
  if (search) {
    // job_card_number first: prepress reads a number off a printed card
    // and searches for it, so it is the most common lookup on the floor.
    query = query.or(
      `job_card_number.ilike.%${search}%,po_number.ilike.%${search}%,party.ilike.%${search}%,job_name.ilike.%${search}%`
    );
  }

  const { data, error } = await query;

  if (error) {
    console.error('[GET /api/jobs]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ jobs: data });
}

// ── POST ──────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  // Verify authenticated + get department
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dept = parseDepartment(user.user_metadata?.department);
  if (!dept) {
    return NextResponse.json({ error: 'Invalid department in token' }, { status: 403 });
  }

  const body: AddJobFormData = await request.json();

  // ── Validate required fields ──
  if (!body.po_number?.trim()) {
    return NextResponse.json({ error: 'PO number is required' }, { status: 400 });
  }
  if (!body.party?.trim()) {
    return NextResponse.json({ error: 'Party name is required' }, { status: 400 });
  }

  // Use admin client to bypass RLS for insert — we've already verified auth above
  const admin = createAdminClient();

  // ── Resolve printing method from the chosen unit ──
  // Each unit runs exactly one process (Unit-1 Offset, Unit-2 Flexo), so the
  // Add Job form asks only for the unit. The unit row is the single source of
  // truth for the method — deriving it here keeps the two from ever
  // disagreeing, which a second form field made possible.
  // No unit named => keep the previous default and let the
  // set_job_printing_unit trigger pick that method's default unit.
  let printingMethod: string = body.printing_method || 'Flexo';
  if (body.printing_unit_id) {
    const { data: unit, error: unitError } = await admin
      .from('printing_units')
      .select('printing_method')
      .eq('id', body.printing_unit_id)
      .single();

    if (unitError || !unit) {
      return NextResponse.json(
        { error: 'Selected printing unit was not found' },
        { status: 400 }
      );
    }
    printingMethod = unit.printing_method;
  }

  // ── Insert job row ──
  const jobPayload = {
    po_number:            body.po_number.trim(),
    pm_code:              body.pm_code?.trim() || null,
    party:                body.party.trim(),
    job_name:             body.job_name?.trim() || null,
    label_qty:            body.label_qty || null,
    po_date:              body.po_date || null,
    delivery_date:        body.delivery_date || null,
    status:               body.status || 'PO Received',
    job_type:             body.job_type || 'New',
    urgent:               body.urgent ?? false,
    urgent_priority:      body.urgent ? (body.urgent_priority ?? null) : null,
    notes:                body.notes?.trim() || null,
    dispatched_qty:       0,
    is_scheduled_release: body.is_scheduled_release ?? false,
    is_closed:            false,
    printing_method:      printingMethod,
    // null is meaningful: it tells the set_job_printing_unit trigger to
    // pick the default unit for the chosen method.
    printing_unit_id:     body.printing_unit_id || null,
  };

  const { data: job, error: jobError } = await admin
    .from('jobs')
    .insert(jobPayload)
    .select()
    .single();

  if (jobError) {
    console.error('[POST /api/jobs] insert job:', jobError);
    return NextResponse.json({ error: jobError.message }, { status: 500 });
  }

  // ── Write initial status log ──
  const { error: logError } = await admin
    .from('job_status_logs')
    .insert({
      job_id:          job.id,
      status:          job.status,
      changed_by_dept: dept,
      remark:          null,
      qty_dispatched:  null,
    });

  if (logError) {
    console.error('[POST /api/jobs] insert log:', logError);
    // Don't fail the whole request for a log write failure — job is created
  }

  // ── Write initial stage timestamps ──
  // A job created at a mid-pipeline stage (e.g. Repeat at 'In Printing') has
  // logically passed all earlier visible stages — stamp them all so the
  // history shows ticks and prerequisite checks pass.
  const visibleStages = getVisibleStages(job.job_type);
  const initialIdx = visibleStages.indexOf(job.status);
  const stagesToStamp = initialIdx >= 0
    ? visibleStages.slice(0, initialIdx + 1)
    : [job.status];

  await admin
    .from('job_stage_timestamps')
    .insert(
      stagesToStamp.map((stage) => ({
        job_id:       job.id,
        stage,
        completed_at: new Date().toISOString(),
      }))
    );

  // ── Insert dispatch schedule rows (if scheduled release) ──
  if (body.is_scheduled_release && body.scheduled_releases?.length) {
    const scheduleRows = body.scheduled_releases.map((r) => ({
      job_id:         job.id,
      release_number: r.release_number,
      planned_qty:    r.planned_qty,
      planned_date:   r.planned_date,
      status:         'Pending' as const,
    }));

    const { error: scheduleError } = await admin
      .from('dispatch_schedules')
      .insert(scheduleRows);

    if (scheduleError) {
      console.error('[POST /api/jobs] insert schedules:', scheduleError);
    }
  }

  return NextResponse.json({ job }, { status: 201 });
}
