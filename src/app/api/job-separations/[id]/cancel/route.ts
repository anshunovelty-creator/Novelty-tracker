// src/app/api/job-separations/[id]/cancel/route.ts
// ============================================================
// POST /api/job-separations/[id]/cancel — mark a row cancelled instead of
// deleting it (Prepress or Admin). Replaces the old hard DELETE: the row
// and its Sr. No. stay visible forever, struck through, so nobody has to
// wonder where a number went. One-way — there's no un-cancel endpoint.
// A reason is required so the strike-through is self-explaining.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseDepartment, canDeptManageJobSeparation } from '@/lib/constants/departments';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dept = parseDepartment(user.user_metadata?.department);
  if (!dept) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });

  if (!canDeptManageJobSeparation(dept)) {
    return NextResponse.json(
      { error: 'Only Prepress or Admin can cancel a job separation row' },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason) {
    return NextResponse.json({ error: 'A cancellation reason is required' }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: existing, error: fetchError } = await admin
    .from('job_separations')
    .select('id, cancelled_at')
    .eq('id', id)
    .single();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: 'Job separation row not found' }, { status: 404 });
  }
  if (existing.cancelled_at) {
    return NextResponse.json({ error: 'This row has already been cancelled' }, { status: 409 });
  }

  const { data, error } = await admin
    .from('job_separations')
    .update({
      cancelled_at:  new Date().toISOString(),
      cancelled_by:  user.email ?? dept,
      cancel_reason: reason,
    })
    .eq('id', id)
    .is('cancelled_at', null)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    return NextResponse.json({ error: 'This row has already been cancelled' }, { status: 409 });
  }

  return NextResponse.json({ job_separation: data });
}
