// src/app/api/messages/conversations/route.ts
// ============================================================
// GET  /api/messages/conversations — list the caller's threads, newest
//      activity first, each with its last message + unread count (reads
//      the my_conversations view, see migration 059) plus its roster.
// POST /api/messages/conversations — start a new thread. Admin only: any
//      participant can reply once a thread exists (see /[id]/messages),
//      but only Admin tags people into a brand new one.
// ============================================================

import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions } from '@/lib/constants/departments';
import type { ConversationSummary, ConversationParticipant } from '@/lib/types';
import { deptKeyOf } from '@/lib/identity';

// ── GET ───────────────────────────────────────────────────────
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: rows, error } = await supabase
    .from('my_conversations')
    .select('*')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[GET /api/messages/conversations]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const ids = (rows ?? []).map((r) => r.conversation_id);
  let participantsByConv = new Map<string, ConversationParticipant[]>();

  if (ids.length > 0) {
    const { data: participants, error: partError } = await supabase
      .from('conversation_participants')
      .select('conversation_id, member_id, member_email, last_read_at')
      .in('conversation_id', ids);

    if (partError) {
      console.error('[GET /api/messages/conversations] participants', partError);
      return NextResponse.json({ error: partError.message }, { status: 500 });
    }

    participantsByConv = new Map();
    for (const p of participants ?? []) {
      const list = participantsByConv.get(p.conversation_id) ?? [];
      list.push({ member_id: p.member_id, member_email: p.member_email, last_read_at: p.last_read_at });
      participantsByConv.set(p.conversation_id, list);
    }
  }

  const conversations: ConversationSummary[] = (rows ?? []).map((r) => ({
    conversation_id:            r.conversation_id,
    subject:                    r.subject,
    started_by:                 r.started_by,
    created_at:                 r.created_at,
    last_read_at:               r.last_read_at,
    last_message_id:            r.last_message_id,
    last_message_body:          r.last_message_body,
    last_message_sender_email:  r.last_message_sender_email,
    last_message_at:            r.last_message_at,
    unread_count:                r.unread_count,
    participants:                participantsByConv.get(r.conversation_id) ?? [],
  }));

  return NextResponse.json({ conversations });
}

// ── POST ──────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!perms?.isSuperAdmin) {
    return NextResponse.json({ error: 'Only Admin can start a new conversation' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));

  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text) {
    return NextResponse.json({ error: 'Message cannot be empty' }, { status: 400 });
  }

  const subject = typeof body.subject === 'string' && body.subject.trim() ? body.subject.trim() : null;
  const jobId   = typeof body.jobId === 'string' && body.jobId ? body.jobId : null;

  const recipientIds: string[] = Array.isArray(body.recipientIds)
    ? Array.from(new Set(body.recipientIds.filter((id: unknown): id is string => typeof id === 'string' && id !== user.id)))
    : [];

  if (recipientIds.length === 0) {
    return NextResponse.json({ error: 'Tag at least one team member' }, { status: 400 });
  }

  // Resolve recipient emails server-side rather than trusting the client's
  // copy — mirrors GET /api/team, which is this same admin.auth.admin
  // listing every other team-facing screen already reads from.
  const admin = createAdminClient();
  const { data: userList, error: listError } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (listError) return NextResponse.json({ error: listError.message }, { status: 500 });

  const emailById = new Map(userList.users.map((u) => [u.id, u.email ?? '']));
  const missing = recipientIds.filter((id) => !emailById.has(id));
  if (missing.length > 0) {
    return NextResponse.json({ error: 'One or more tagged members no longer exist' }, { status: 400 });
  }

  // No .select() here deliberately: RETURNING a row from an INSERT is also
  // subject to the table's SELECT policy (is_conversation_participant),
  // which nothing can satisfy yet — the creator's own participant row
  // doesn't exist until the very next insert below. Postgres reports that
  // exactly like a WITH CHECK failure ("new row violates row-level
  // security policy"), even though the insert itself is fully allowed.
  // Generating the id here sidesteps needing RETURNING at all.
  const conversationId = randomUUID();
  const now = new Date().toISOString();

  const { error: convError } = await supabase
    .from('conversations')
    .insert({ id: conversationId, subject, started_by: user.id, created_at: now });

  if (convError) {
    console.error('[POST /api/messages/conversations] conversation', convError);
    return NextResponse.json({ error: convError.message }, { status: 500 });
  }

  const conversation = { id: conversationId, subject, started_by: user.id, created_at: now };
  const participantRows = [
    // The sender never sees their own new thread as unread.
    { conversation_id: conversation.id, member_id: user.id, member_email: user.email, last_read_at: now },
    ...recipientIds.map((id) => ({
      conversation_id: conversation.id,
      member_id:       id,
      member_email:    emailById.get(id)!,
      last_read_at:    null,
    })),
  ];

  const { error: partError } = await supabase.from('conversation_participants').insert(participantRows);
  if (partError) {
    console.error('[POST /api/messages/conversations] participants', partError);
    return NextResponse.json({ error: partError.message }, { status: 500 });
  }

  const { data: message, error: msgError } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversation.id,
      sender_id:        user.id,
      sender_email:      user.email,
      body:               text,
      job_id:              jobId,
    })
    .select('*')
    .single();

  if (msgError) {
    console.error('[POST /api/messages/conversations] message', msgError);
    return NextResponse.json({ error: msgError.message }, { status: 500 });
  }

  return NextResponse.json({ conversation, message }, { status: 201 });
}
