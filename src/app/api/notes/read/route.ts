// src/app/api/notes/read/route.ts
// ============================================================
// POST /api/notes/read  { ids: string[] }
//   Marks the given notes as read by the calling user. Upsert so a
//   re-click (double network request, stale UI) is a harmless no-op
//   rather than a duplicate-key error.
//
// Called by: src/components/admin/NotesFeed.tsx ("Mark as read").
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

const MAX_IDS = 100;

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const ids: unknown = body?.ids;

  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string')) {
    return NextResponse.json({ error: 'ids must be a non-empty array of strings' }, { status: 400 });
  }
  if (ids.length > MAX_IDS) {
    return NextResponse.json({ error: `ids cannot exceed ${MAX_IDS}` }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from('note_reads')
    .upsert(
      ids.map((note_id) => ({ note_id, user_email: user.email })),
      { onConflict: 'note_id,user_email', ignoreDuplicates: true }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
