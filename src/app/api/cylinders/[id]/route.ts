// src/app/api/cylinders/[id]/route.ts
// ============================================================
// PATCH  /api/cylinders/[id] — correct a cylinder record
// DELETE /api/cylinders/[id] — remove it outright
//                              cylinders_edit or Admin only.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptManageCylinders } from '@/lib/constants/departments';
import { parseCylinder } from '@/lib/cylinders';
import { deptKeyOf } from '@/lib/identity';

type Params = { params: Promise<{ id: string }> };

async function allowed() {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!canDeptManageCylinders(perms)) {
    return NextResponse.json({ error: 'Your department cannot change cylinders' }, { status: 403 });
  }
  return null;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const denied = await allowed();
  if (denied) return denied;

  const parsed = parseCylinder(await request.json(), true);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (Object.keys(parsed.fields).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const { data, error } = await createAdminClient()
    .from('cylinders')
    .update(parsed.fields)
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A cylinder with that serial number already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Cylinder not found' }, { status: 404 });
  return NextResponse.json({ cylinder: data });
}

// Hard delete, like plates: hand-typed rows, nothing else points at one.
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const denied = await allowed();
  if (denied) return denied;

  const { error } = await createAdminClient().from('cylinders').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
