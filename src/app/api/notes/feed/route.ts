// src/app/api/notes/feed/route.ts
// ============================================================
// GET /api/notes/feed?limit=50
//   Newest-first internal notes across every job (and general notes
//   with no job, migration 077), for the global
//   notes box in the admin shell. Each note carries `read`, the
//   caller's own read state (see migration 017_note_reads).
//
//   `limit`  — page size, 1..100, default 50.
//   `q`      — optional search: notes whose text contains it (2+ chars),
//              across all notes, not just the newest page.
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
import { getClaimsUser } from '@/lib/supabase/claims';
import { containsPattern } from '@/lib/search';
import type { NoteFeedItem } from '@/lib/types';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT     = 100;

// Notes are written constantly; never serve a cached feed.
export const dynamic = 'force-dynamic';

type JoinedRow = {
  id:               string;
  job_id:           string | null;
  stage:            string | null;
  comment:          string;
  created_by:       string;
  created_by_email: string | null;
  created_at:       string;
  reply_to_id:      string | null;
  /** Absent until migration 079 runs — read through `*` so the feed works either way. */
  edited_at?:       string | null;
  jobs: {
    job_name:  string | null;
    pm_code:   string | null;
    po_number: string;
    party:     string;
    status:    string;
  } | null;
};

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const params = new URL(request.url).searchParams;

  // Clamp rather than reject: a bad limit should not break the poll loop.
  const rawLimit = Number.parseInt(params.get('limit') ?? '', 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const query = supabase
    .from('stage_comments')
    // `*` rather than a column list: edited_at (079) is picked up once the
    // column exists, and the feed keeps working before the migration runs.
    .select('*, jobs ( job_name, pm_code, po_number, party, status )')
    .order('created_at', { ascending: false })
    .limit(limit);
  const q = params.get('q')?.trim() ?? '';
  const { data, error } = await (q.length >= 2 ? query.ilike('comment', containsPattern(q)) : query);

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

  // The quoted original of each reply (migration 078). Usually already in
  // this page; an older one is fetched — one query for all of them.
  type Quoted = NonNullable<NoteFeedItem['reply_to']>;
  const quoted = new Map<string, Quoted>(rows.map((r) => [r.id, {
    id: r.id, comment: r.comment, created_by: r.created_by, created_by_email: r.created_by_email,
  }]));
  const missing = Array.from(new Set(rows.map((r) => r.reply_to_id).filter((id): id is string => !!id && !quoted.has(id))));
  if (missing.length) {
    const { data: parents, error: parentError } = await supabase
      .from('stage_comments')
      .select('id, comment, created_by, created_by_email')
      .in('id', missing);
    if (parentError) return NextResponse.json({ error: parentError.message }, { status: 500 });
    for (const p of (parents ?? []) as Quoted[]) quoted.set(p.id, p);
  }

  // Flatten the join so the client gets one object per note. A general
  // note (no job, migration 077) keeps null job fields; a note whose job
  // row is missing (deleted mid-flight) is dropped rather than rendered
  // with blank identity.
  const notes: NoteFeedItem[] = rows
    .filter((r) => r.job_id === null || r.jobs !== null)
    .map((r) => ({
      id:               r.id,
      job_id:           r.job_id,
      stage:            r.stage as NoteFeedItem['stage'],
      comment:          r.comment,
      created_by:       r.created_by,
      created_by_email: r.created_by_email,
      created_at:       r.created_at,
      job_name:         r.jobs?.job_name ?? null,
      pm_code:          r.jobs?.pm_code ?? null,
      po_number:        r.jobs?.po_number ?? null,
      party:            r.jobs?.party ?? null,
      job_status:       r.jobs?.status,
      read:             readIds.has(r.id),
      reply_to:         r.reply_to_id ? quoted.get(r.reply_to_id) ?? null : null,
      edited_at:        r.edited_at ?? null,
    }));

  // Unread = notes in this page the caller hasn't marked read, excluding
  // their own — matches the "remaining to read" count in the panel badge.
  const unread = notes.filter(
    (n) => !n.read && n.created_by_email !== user.email
  ).length;

  return NextResponse.json({ notes, unread });
}
