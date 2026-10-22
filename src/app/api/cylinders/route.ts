// src/app/api/cylinders/route.ts
// ============================================================
// GET  /api/cylinders — every cylinder (any authenticated user)
// POST /api/cylinders — record a cylinder (cylinders_edit or Admin)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptManageCylinders } from '@/lib/constants/departments';
import { parseCylinder } from '@/lib/cylinders';
import { deptKeyOf } from '@/lib/identity';

// A shop owns tens of cylinders, not thousands: the page gets them all and
// searches in the browser.
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('cylinders')
    .select('*')
    .order('teeth', { ascending: true })
    .order('serial_no', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ cylinders: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!perms) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });
  if (!canDeptManageCylinders(perms)) {
    return NextResponse.json({ error: 'Your department cannot add cylinders' }, { status: 403 });
  }

  const parsed = parseCylinder(await request.json());
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { data, error } = await createAdminClient()
    .from('cylinders')
    .insert({ ...parsed.fields, created_by: user.email ?? perms.key })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A cylinder with that serial number already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ cylinder: data }, { status: 201 });
}
