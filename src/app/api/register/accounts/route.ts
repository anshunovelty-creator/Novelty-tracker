// src/app/api/register/accounts/route.ts
// ============================================================
// GET  /api/register/accounts — list accounts, newest first.
// POST /api/register/accounts — add an account.
// Admin only, both directions — see canDeptManageRegister.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseDepartment, canDeptManageRegister } from '@/lib/constants/departments';

function text(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

async function requireAdmin() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;

  const dept = parseDepartment(user.user_metadata?.department);
  if (!canDeptManageRegister(dept)) {
    return { error: NextResponse.json({ error: 'Register is Admin only' }, { status: 403 }) } as const;
  }
  return { user, dept, supabase } as const;
}

export async function GET(_request: NextRequest) {
  const gate = await requireAdmin();
  if ('error' in gate) return gate.error;

  const { data, error } = await gate.supabase
    .from('register_accounts')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ accounts: data ?? [] });
}

export async function POST(request: NextRequest) {
  const gate = await requireAdmin();
  if ('error' in gate) return gate.error;

  const body = await request.json();
  const name = text(body.name);
  if (!name) return NextResponse.json({ error: 'Company name is required' }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('register_accounts')
    .insert({
      name,
      contact_name: text(body.contact_name),
      contact_role: text(body.contact_role),
      phone:        text(body.phone),
      email:        text(body.email),
      segment:      text(body.segment),
      city:         text(body.city),
      notes:        text(body.notes),
      created_by:   gate.user.email ?? gate.dept,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ account: data }, { status: 201 });
}
