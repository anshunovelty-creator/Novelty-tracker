// src/app/api/party-contacts/route.ts
// ============================================================
// GET  /api/party-contacts — list every party's dispatch-email contact
//      (Dispatch/Admin can view; needed to know who actually gets emailed)
// POST /api/party-contacts — add/update a contact for a party (Admin only,
//      matches party_contacts' existing RLS — contact management is an
//      admin responsibility)
//
// `party` must match jobs.party exactly (case-sensitive) — see migration
// 002. Upserts on party so re-adding the same party edits it in place.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptManageDispatchNotifications, canDeptManagePartyContacts } from '@/lib/constants/departments';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!canDeptManageDispatchNotifications(perms)) {
    return NextResponse.json({ error: 'Only Dispatch/Admin can view party contacts' }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('party_contacts')
    .select('*')
    .order('party', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contacts: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!canDeptManagePartyContacts(perms)) {
    return NextResponse.json({ error: 'Only Admin can manage party contacts' }, { status: 403 });
  }

  const body = await request.json();
  const party = typeof body.party === 'string' ? body.party.trim() : '';
  if (!party) {
    return NextResponse.json({ error: 'Choose a party' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (email && !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });
  }
  const whatsapp    = typeof body.whatsapp === 'string' ? body.whatsapp.trim() || null : null;
  const contactName = typeof body.contact_name === 'string' ? body.contact_name.trim() || null : null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('party_contacts')
    .upsert(
      { party, contact_name: contactName, email: email || null, whatsapp },
      { onConflict: 'party' },
    )
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contact: data }, { status: 201 });
}
