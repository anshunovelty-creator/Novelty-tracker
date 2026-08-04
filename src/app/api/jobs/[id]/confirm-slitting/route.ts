// src/app/api/jobs/[id]/confirm-slitting/route.ts
// ============================================================
// POST /api/jobs/[id]/confirm-slitting
//
// Postpress-only confirmation that slitting is physically done.
//
// Slitting is entered automatically the instant Production completes
// printing on the machine board (advanceJobStageFromMachine writes
// jobs.status directly, with no Postpress action involved). That means
// job.status === 'Slitting' alone was never proof the work was finished —
// see migration 018_slitting_confirmation for the full story. The manual
// status-dropdown path already sets jobs.slitting_confirmed_at itself
// (see /status route, section 7) since picking "Slitting" by hand is a
// real department action; this endpoint exists only to cover the
// machine-board path, which bypasses /status entirely.
//
// Idempotent: confirming twice is a no-op past the first call.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseDepartment } from '@/lib/constants/departments';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dept = parseDepartment(user.user_metadata?.department);
  if (dept !== 'Postpress' && dept !== 'Admin') {
    return NextResponse.json(
      { error: 'Only Postpress or Admin can confirm slitting' },
      { status: 403 }
    );
  }

  const admin = createAdminClient();

  const { data: job, error: jobError } = await admin
    .from('jobs')
    .select('id, status, is_closed, slitting_confirmed_at')
    .eq('id', id)
    .maybeSingle();

  if (jobError || !job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  if (job.is_closed)     return NextResponse.json({ error: 'Cannot update a closed PO' }, { status: 400 });
  if (job.status !== 'Slitting') {
    return NextResponse.json({ error: 'Job is not in Slitting' }, { status: 400 });
  }

  if (!job.slitting_confirmed_at) {
    const now = new Date().toISOString();

    const { error: updateError } = await admin
      .from('jobs')
      .update({ slitting_confirmed_at: now })
      .eq('id', id);

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    // stage_comments are internal-only (never reach the client portal) —
    // same audit pattern as advanceJobStageFromMachine's "[Auto]" notes.
    await admin
      .from('stage_comments')
      .insert({
        job_id:     id,
        stage:      'Slitting',
        comment:    '[Auto] Slitting marked complete — ready for QC.',
        created_by: dept,
      });
  }

  const { data: updatedJob, error: refetchError } = await admin
    .from('jobs')
    .select('*, job_stage_timestamps(stage), printing_units(id, name, printing_method)')
    .eq('id', id)
    .single();

  if (refetchError) return NextResponse.json({ error: refetchError.message }, { status: 500 });

  return NextResponse.json({ job: updatedJob });
}
