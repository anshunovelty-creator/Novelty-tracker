// src/app/api/job-separations/[id]/route.ts
// ============================================================
// PATCH /api/job-separations/[id] — correct a row. Prepress or Admin.
//
// There is no DELETE here — a row is hand-typed off a PO, so mis-entries
// happen, but hard-deleting one leaves a gap in the Sr. No. sequence with
// no explanation. Use POST /api/job-separations/[id]/cancel instead: it
// marks the row cancelled (with a required reason) rather than removing it.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseDepartment, canDeptManageJobSeparation } from '@/lib/constants/departments';

type Params = { params: Promise<{ id: string }> };

const TEXT_FIELDS = [
  'sr_no', 'po_no', 'po_date', 'pm_code', 'material_name', 'unit',
  'job_status', 'jc_status', 'aw_send_to',
] as const;

const INT_FIELDS = ['quantity'] as const;

// Returns the response to send back when the caller may not write, null when
// they may. Both verbs on this route gate identically.
async function denyWrite(): Promise<NextResponse | null> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dept = parseDepartment(user.user_metadata?.department);
  if (!dept) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });

  if (!canDeptManageJobSeparation(dept)) {
    return NextResponse.json(
      { error: 'Only Prepress or Admin can change job separation rows' },
      { status: 403 }
    );
  }

  return null;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;

  const denied = await denyWrite();
  if (denied) return denied;

  const body = await request.json();
  const updates: Record<string, unknown> = {};

  if ('party' in body) {
    const party = typeof body.party === 'string' ? body.party.trim() : '';
    if (!party) {
      return NextResponse.json({ error: 'Party is required' }, { status: 400 });
    }
    updates.party = party;
  }

  for (const field of TEXT_FIELDS) {
    if (field in body) {
      updates[field] = typeof body[field] === 'string' ? body[field].trim() || null : null;
    }
  }

  for (const field of INT_FIELDS) {
    if (field in body) {
      const raw = body[field];
      const n = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
      updates[field] = Number.isFinite(n) ? Math.trunc(n) : null;
    }
  }

  // Rate carries paise — no truncation.
  if ('rate' in body) {
    const raw = body.rate;
    const n = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
    updates.rate = Number.isFinite(n) ? n : null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('job_separations')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: `Sr. No. ${updates.sr_no} is already on another row` },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Job separation row not found' }, { status: 404 });

  return NextResponse.json({ job_separation: data });
}
