// src/app/api/party-contacts/[id]/route.ts
// PATCH  /api/party-contacts/[id] — edit an existing contact. Admin only.
// DELETE /api/party-contacts/[id] — remove a contact. Admin only.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptManagePartyContacts } from '@/lib/constants/departments';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!canDeptManagePartyContacts(perms)) {
    return NextResponse.json({ error: 'Only Admin can manage party contacts' }, { status: 403 });
  }

  const body  = await request.json();
  const party = typeof body.party === 'string' ? body.party.trim() : '';
  if (!party) return NextResponse.json({ error: 'Choose a party' }, { status: 400 });

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (email && !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });
  }
  const whatsapp    = typeof body.whatsapp === 'string' ? body.whatsapp.trim() || null : null;
  const contactName = typeof body.contact_name === 'string' ? body.contact_name.trim() || null : null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('party_contacts')
    .update({ party, contact_name: contactName, email: email || null, whatsapp })
    .eq('id', id)
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contact: data });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params;

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!canDeptManagePartyContacts(perms)) {
    return NextResponse.json({ error: 'Only Admin can manage party contacts' }, { status: 403 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from('party_contacts')
    .delete()
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
