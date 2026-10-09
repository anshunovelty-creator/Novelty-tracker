// src/app/api/notes/[id]/route.ts
// ============================================================
// DELETE /api/notes/[id]
//   Admin only: removes an internal note for everyone — from the Notes
//   drawer and from its job's history. A real delete, not a hide: its read
//   receipts go with it (note_reads ON DELETE CASCADE, 016) and replies that
//   quoted it keep their text but lose the quote (reply_to_id ON DELETE SET
//   NULL, 078).
//
// stage_comments has no DELETE policy (append-only for everyone else), so
// the write goes through the service-role client after the admin check.
//
// Called by: src/components/admin/NotesFeed.tsx (bubble → Delete for everyone).
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions } from '@/lib/constants/departments';
import { deptKeyOf } from '@/lib/identity';
import { parseNoteId } from '@/lib/notesView';

type Params = { params: Promise<{ id: string }> };

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
