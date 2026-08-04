// src/app/api/notes/feed/route.ts
// ============================================================
// GET /api/notes/feed?limit=50
//   Newest-first internal notes across every job, for the global
//   notes box in the admin shell. Each note carries `read`, the
//   caller's own read state (see migration 017_note_reads).
//
//   `limit`  — page size, 1..100, default 50.
//
//   Returns { notes: NoteFeedItem[], unread: number }.
//   `unread` counts notes in this page that are unread and not the
//   caller's own. One round trip per poll: the list and the badge
//   count come together.
//
// Access: uses the RLS-respecting server client. stage_comments already
// grants SELECT to every authenticated user (migration 001), so this
// endpoint exposes nothing that job detail did not already expose —
// it only changes the shape of the query.
//
// Called by: src/components/admin/NotesFeed.tsx (poll loop).
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { NoteFeedItem } from '@/lib/types';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT     = 100;

// Notes are written constantly; never serve a cached feed.
export const dynamic = 'force-dynamic';

type JoinedRow = {
  id:               string;
  job_id:           string;
  stage:            string;
  comment:          string;
  created_by:       string;
  created_by_email: string | null;
  created_at:       string;
  jobs: {
    job_name:  string | null;
    pm_code:   string | null;
    po_number: string;
    party:     string;
  } | null;
};

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const params = new URL(request.url).searchParams;

  // Clamp rather than reject: a bad limit should not break the poll loop.
  const rawLimit = Number.parseInt(params.get('limit') ?? '', 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const { data, error } = await supabase
    .from('stage_comments')
    .select(`
      id,
      job_id,
      stage,
      comment,
      created_by,
      created_by_email,
      created_at,
      jobs ( job_name, pm_code, po_number, party )
    `)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as unknown as JoinedRow[];

  // Which of these notes has the caller already marked read?
  const noteIds = rows.map((r) => r.id);
  const { data: readRows, error: readError } = noteIds.length
    ? await supabase
        .from('note_reads')
        .select('note_id')
        .eq('user_email', user.email ?? '')
        .in('note_id', noteIds)
    : { data: [], error: null };

  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });

  const readIds = new Set((readRows ?? []).map((r: { note_id: string }) => r.note_id));

  // Flatten the join so the client gets one object per note.
  // A note whose job row is missing (deleted mid-flight) is dropped
  // rather than rendered with blank identity.
  const notes: NoteFeedItem[] = rows
    .filter((r) => r.jobs !== null)
    .map((r) => ({
      id:               r.id,
      job_id:           r.job_id,
      stage:            r.stage as NoteFeedItem['stage'],
      comment:          r.comment,
      created_by:       r.created_by,
      created_by_email: r.created_by_email,
      created_at:       r.created_at,
      job_name:         r.jobs!.job_name,
      pm_code:          r.jobs!.pm_code,
      po_number:        r.jobs!.po_number,
      party:            r.jobs!.party,
      read:             readIds.has(r.id),
    }));

  // Unread = notes in this page the caller hasn't marked read, excluding
  // their own — matches the "remaining to read" count in the panel badge.
  const unread = notes.filter(
    (n) => !n.read && n.created_by_email !== user.email
  ).length;

  return NextResponse.json({ notes, unread });
}
