// src/app/api/party-contacts/[id]/route.ts
// DELETE /api/party-contacts/[id] — remove a party's dispatch-email contact. Admin only.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptManagePartyContacts } from '@/lib/constants/departments';

type Params = { params: Promise<{ id: string }> };

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
