// src/app/api/notes/route.ts
// ============================================================
// POST /api/notes  { comment, reply_to_id? }
//   A general internal note — not on any job (job_id and stage NULL, see
//   migration 077_general_notes). Notes on a job still go through
//   POST /api/jobs/[id]/comments, filed at the job's stage. reply_to_id
//   quotes another note (migration 078).
//
// Called by: src/components/admin/NotesFeed.tsx (composer, "No job").
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions } from '@/lib/constants/departments';
import { deptKeyOf } from '@/lib/identity';
import { parseNoteId } from '@/lib/notesView';

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!perms) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const comment = typeof body?.comment === 'string' ? body.comment.trim() : '';
  if (!comment) return NextResponse.json({ error: 'comment is required' }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('stage_comments')
    .insert({
      job_id:           null,
      stage:            null,
      comment,
      reply_to_id:      parseNoteId(body?.reply_to_id),
      created_by:       perms.key,
      created_by_email: user.email ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ comment: data }, { status: 201 });
}
