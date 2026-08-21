// src/app/api/register/accounts/[id]/route.ts
// ============================================================
// PATCH  /api/register/accounts/[id] — edit an account.
// DELETE /api/register/accounts/[id] — remove an account and everything
//        under it (deals, activities cascade via FK ON DELETE CASCADE).
// Admin only.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptManageRegister } from '@/lib/constants/departments';

type Params = { params: Promise<{ id: string }> };

function text(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

async function requireAdmin() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!canDeptManageRegister(perms)) {
    return { error: NextResponse.json({ error: 'Register is Admin only' }, { status: 403 }) } as const;
  }
  return { user, perms } as const;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const gate = await requireAdmin();
  if ('error' in gate) return gate.error;

  const body = await request.json();
  const name = text(body.name);
  if (!name) return NextResponse.json({ error: 'Company name is required' }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('register_accounts')
    .update({
      name,
      contact_name: text(body.contact_name),
      contact_role: text(body.contact_role),
      phone:        text(body.phone),
      email:        text(body.email),
      segment:      text(body.segment),
      city:         text(body.city),
      notes:        text(body.notes),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ account: data });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const gate = await requireAdmin();
  if ('error' in gate) return gate.error;

  const admin = createAdminClient();
  const { data, error } = await admin.from('register_accounts').delete().eq('id', id).select('id');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
