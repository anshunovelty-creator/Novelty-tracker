// src/app/api/meter-calculator-access/route.ts
// ============================================================
// GET  /api/meter-calculator-access  — list who is individually granted
//                                       the Meter Calculator (super-admin only)
// POST /api/meter-calculator-access  — grant one user (super-admin only)
//
// Rows in meter_calculator_access (migration 048) — mirrors the /api/team
// Auth-is-the-source-of-truth model. Gated on isSuperAdmin directly, the
// same as /admin/departments itself: this edits the permission system,
// not a feature any department can be handed.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions } from '@/lib/constants/departments';

async function requireSuperAdmin(): Promise<
  { userId: string } | { error: NextResponse }
> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!perms?.isSuperAdmin) {
    return { error: NextResponse.json({ error: 'Only Admin can manage Meter Calculator access' }, { status: 403 }) };
  }
  return { userId: user.id };
}

export async function GET() {
  const auth = await requireSuperAdmin();
  if ('error' in auth) return auth.error;

  const admin = createAdminClient();
  const [{ data: grants, error }, { data: usersPage, error: usersError }] = await Promise.all([
    admin.from('meter_calculator_access').select('user_id, created_at').order('created_at', { ascending: false }),
    admin.auth.admin.listUsers({ perPage: 200 }),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (usersError) return NextResponse.json({ error: usersError.message }, { status: 500 });

  const emailById = new Map(usersPage.users.map((u) => [u.id, u.email ?? '']));
  const result = (grants ?? []).map((g) => ({
    user_id:    g.user_id,
    email:      emailById.get(g.user_id) ?? '(deleted user)',
    created_at: g.created_at,
  }));

  return NextResponse.json({ grants: result });
}

export async function POST(request: NextRequest) {
  const auth = await requireSuperAdmin();
  if ('error' in auth) return auth.error;

  const body = await request.json();
  const userId = typeof body.user_id === 'string' ? body.user_id.trim() : '';
  if (!userId) {
    return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('meter_calculator_access')
    .insert({ user_id: userId, granted_by: auth.userId })
    .select('user_id, created_at')
    .single();

  if (error) {
    const message = error.code === '23505' ? 'That person already has access' : error.message;
    return NextResponse.json({ error: message }, { status: 409 });
  }

  return NextResponse.json({ grant: data }, { status: 201 });
}
