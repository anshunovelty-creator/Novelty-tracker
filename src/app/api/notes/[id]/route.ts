// src/app/api/notes/[id]/route.ts
// ============================================================
// PATCH  /api/notes/[id]  { comment }
//   The author fixes their own note within 15 minutes of posting
//   (canEditNote); sets edited_at so the bubble says "edited" (079).
//
// DELETE /api/notes/[id]
//   Admin only: removes an internal note for everyone — from the Notes
//   drawer and from its job's history. A real delete, not a hide: its read
//   receipts go with it (note_reads ON DELETE CASCADE, 016) and replies that
//   quoted it keep their text but lose the quote (reply_to_id ON DELETE SET
//   NULL, 078).
//
// stage_comments has no UPDATE or DELETE policy (append-only for everyone
// else), so both writes go through the service-role client after their own
// checks.
//
// Called by: src/components/admin/NotesFeed.tsx (Edit, Delete for everyone).
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions } from '@/lib/constants/departments';
import { deptKeyOf } from '@/lib/identity';
import { parseNoteId, canEditNote } from '@/lib/notesView';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const id = parseNoteId((await params).id);
  if (!id) return NextResponse.json({ error: 'Invalid note id' }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const comment = typeof body?.comment === 'string' ? body.comment.trim() : '';
  if (!comment) return NextResponse.json({ error: 'comment is required' }, { status: 400 });

  const admin = createAdminClient();
  const { data: note, error: readError } = await admin
    .from('stage_comments')
    .select('created_by_email, created_at')
    .eq('id', id)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  if (!note) return NextResponse.json({ error: 'Note not found' }, { status: 404 });
  if (!canEditNote(note, user.email)) {
    return NextResponse.json({ error: 'You can only edit your own note, within 15 minutes of posting' }, { status: 403 });
  }

  const { data, error } = await admin
    .from('stage_comments')
    .update({ comment, edited_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ comment: data });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const id = parseNoteId((await params).id);
  if (!id) return NextResponse.json({ error: 'Invalid note id' }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!perms?.isSuperAdmin) {
    return NextResponse.json({ error: 'Only Admin can delete notes' }, { status: 403 });
  }

  const { data, error } = await createAdminClient()
    .from('stage_comments')
    .delete()
    .eq('id', id)
    .select('id');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: 'Note not found — it may already be deleted' }, { status: 404 });

  return NextResponse.json({ ok: true });
}
