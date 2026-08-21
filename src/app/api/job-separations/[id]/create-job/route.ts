// src/app/api/job-separations/[id]/create-job/route.ts
// ============================================================
// POST /api/job-separations/[id]/create-job — turn one Job Separation row
// into a Job (Prepress or Admin), so the same PO line doesn't get typed
// twice. Reuses the same insert logic as POST /api/jobs (createJobRecord),
// then stamps the row with the resulting job so a second click can't spawn
// a duplicate Job from the same row.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptManageJobSeparation } from '@/lib/constants/departments';
import { createJobRecord } from '@/lib/jobs/createJob';
import type { AddJobFormData } from '@/lib/types';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!perms) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });

  if (!canDeptManageJobSeparation(perms)) {
    return NextResponse.json(
      { error: 'Only Prepress or Admin can add a Job from a job separation row' },
      { status: 403 }
    );
  }

  const admin = createAdminClient();

  const { data: sep, error: sepError } = await admin
    .from('job_separations')
    .select('id, linked_job_id')
    .eq('id', id)
    .single();

  if (sepError || !sep) {
    return NextResponse.json({ error: 'Job separation row not found' }, { status: 404 });
  }
  if (sep.linked_job_id) {
    return NextResponse.json(
      { error: 'A Job has already been added from this row' },
      { status: 409 }
    );
  }

  const body: AddJobFormData = await request.json();
  const result = await createJobRecord(admin, perms.key, body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // Only stamps the row if it's still unlinked — closes the race where two
  // clicks on the same row both pass the check above before either finishes.
  const { data: updatedSep, error: linkError } = await admin
    .from('job_separations')
    .update({
      linked_job_id:          result.job.id,
      linked_job_card_number: result.job.job_card_number,
    })
    .eq('id', id)
    .is('linked_job_id', null)
    .select()
    .single();

  if (linkError) {
    // The Job itself was created successfully — only the write-back to this
    // row failed (or lost the race to a concurrent click). Surface both so
    // the UI can still confirm the Job exists.
    console.error('[POST /api/job-separations/[id]/create-job] link update:', linkError);
    return NextResponse.json(
      {
        job: result.job,
        job_separation: null,
        warning: 'Job was created, but this row could not be marked as linked — refresh to check.',
      },
      { status: 201 }
    );
  }

  return NextResponse.json({ job: result.job, job_separation: updatedSep }, { status: 201 });
}
