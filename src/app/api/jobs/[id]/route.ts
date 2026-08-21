// src/app/api/jobs/[id]/route.ts
// ============================================================
// GET    /api/jobs/[id]  — full job detail with related data
// PATCH  /api/jobs/[id]  — update job fields (delivery date, notes, etc.)
// DELETE /api/jobs/[id]  — Admin only
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptSetPrinting, canDeptEditJobDetails, canDeptEditDeliveryDate } from '@/lib/constants/departments';

type Params = { params: Promise<{ id: string }> };

// ── GET ───────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Fetch job + all related data in parallel
  const [jobRes, timestampsRes, logsRes, commentsRes, schedulesRes] = await Promise.all([
    supabase.from('jobs').select('*').eq('id', id).single(),
    supabase.from('job_stage_timestamps').select('*').eq('job_id', id).order('completed_at'),
    supabase.from('job_status_logs').select('*').eq('job_id', id).order('changed_at'),
    supabase.from('stage_comments').select('*').eq('job_id', id).order('created_at'),
    supabase.from('dispatch_schedules').select('*').eq('job_id', id).order('release_number'),
  ]);

  if (jobRes.error) {
    if (jobRes.error.code === 'PGRST116') {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }
    return NextResponse.json({ error: jobRes.error.message }, { status: 500 });
  }

  return NextResponse.json({
    job: {
      ...jobRes.data,
      stage_timestamps:  timestampsRes.data ?? [],
      status_logs:       logsRes.data ?? [],
      stage_comments:    commentsRes.data ?? [],
      dispatch_schedules: schedulesRes.data ?? [],
    },
  });
}

// ── PATCH ─────────────────────────────────────────────────────
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!perms) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });

  const body = await request.json();

  // Whitelist of fields that can be PATCHed via this endpoint
  // (status changes go through /api/jobs/[id]/status instead)
  const allowedFields = [
    'delivery_date',
    'notes',
    'urgent',
    'urgent_priority',
    'po_number',
    'party',
    'po_date',
    'job_type',
    'pm_code',
    'job_name',
    'label_qty',
    // Prepress/production reassign the printing unit from the job card.
    // Sending printing_method alone lets the set_job_printing_unit trigger
    // snap the unit to that method's default; sending both is an explicit
    // override the trigger leaves alone.
    'printing_method',
    'printing_unit_id',
  ] as const;

  // Delivery date edit: only Dispatch or Admin
  if ('delivery_date' in body && !canDeptEditDeliveryDate(perms)) {
    return NextResponse.json(
      { error: 'Only Dispatch or Admin can edit delivery date' },
      { status: 403 }
    );
  }

  // Printing method / unit: Prepress, Production or Admin decide which
  // press takes the job. Enforced here as well as in the UI, because the
  // UI control is only a hint — this endpoint is the actual boundary.
  const touchesPrinting = 'printing_method' in body || 'printing_unit_id' in body;
  if (touchesPrinting && !canDeptSetPrinting(perms)) {
    return NextResponse.json(
      { error: 'Only Prepress, Production or Admin can set the printing unit' },
      { status: 403 }
    );
  }

  // Job detail corrections (the Edit Job form): Prepress enters most jobs off
  // the PO, so they fix their own typos; Admin always may. QC and Dispatch see
  // these fields but do not own them.
  const DETAIL_FIELDS = [
    'po_number', 'party', 'pm_code', 'job_name',
    'label_qty', 'job_type', 'po_date', 'notes',
  ];
  const touchedDetails = DETAIL_FIELDS.filter((f) => f in body);
  if (touchedDetails.length > 0 && !canDeptEditJobDetails(perms)) {
    return NextResponse.json(
      {
        error:
          `${perms.key} cannot change job details. ` +
          `Rejected fields: ${touchedDetails.join(', ')}`,
      },
      { status: 403 }
    );
  }

  // Production may change the printing unit and NOTHING else — every other
  // detail stays fixed for them. A bespoke carve-out on the literal
  // 'Production' department key, not a generic feature — kept as-is since
  // it's a restriction narrower than any grantable permission, not a gate.
  if (perms.key === 'Production') {
    const nonPrintingKeys = Object.keys(body).filter(
      (k) => k !== 'printing_method' && k !== 'printing_unit_id',
    );
    if (nonPrintingKeys.length > 0) {
      return NextResponse.json(
        {
          error:
            `${perms.key} can only change the printing unit. ` +
            `Rejected fields: ${nonPrintingKeys.join(', ')}`,
        },
        { status: 403 }
      );
    }
  }

  // PO number and party are how a job is found and who it is for — neither
  // may be blanked by an edit. Everything else is legitimately clearable.
  for (const field of ['po_number', 'party'] as const) {
    if (field in body && !String(body[field] ?? '').trim()) {
      return NextResponse.json(
        { error: `${field === 'po_number' ? 'PO number' : 'Party'} cannot be empty` },
        { status: 400 }
      );
    }
  }

  const updates: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (field in body) updates[field] = body[field];
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const admin = createAdminClient();

  // ── Keep printing_method in step with the unit ──
  // The edit forms now ask only for the unit, and each unit runs exactly one
  // process. Reassigning a job from a Flexo unit to an Offset one must move
  // the method with it, otherwise the job keeps a stale method that
  // contradicts the press it is sitting on.
  // Skipped when a caller sets the method explicitly — no UI does that any
  // more, but the field stays accepted, and an explicit method must win over
  // the derived one rather than be silently overwritten.
  if (updates.printing_unit_id && !('printing_method' in body)) {
    const { data: unit, error: unitError } = await admin
      .from('printing_units')
      .select('printing_method')
      .eq('id', updates.printing_unit_id as string)
      .single();

    if (unitError || !unit) {
      return NextResponse.json(
        { error: 'Selected printing unit was not found' },
        { status: 400 }
      );
    }
    updates.printing_method = unit.printing_method;
  }
  const { data, error } = await admin
    .from('jobs')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ job: data });
}

// ── DELETE ────────────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!perms?.isSuperAdmin) {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from('jobs').delete().eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
