// src/app/api/bom-materials/route.ts
// ============================================================
// GET  /api/bom-materials — the material master, A→Z, retired ones included
//      (the costing table needs a retired material's name and rate to keep
//      pricing the old jobs that use it). bom_use.
// POST /api/bom-materials — add a material with its ₹/m² rate. bom_decide:
//      the rate is the owner's number, and the master is what every
//      expense on the BOM is computed from.
//
// The master no longer fills itself from requests the way the old
// catalogue did — a material is only useful here with a rate on it, and
// nobody but the owner knows the rate.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptUseBOM, canDeptDecideBOM } from '@/lib/constants/departments';

function text(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

// ₹/m². Anything unparseable or negative is rejected, not silently zeroed —
// a wrong rate reprices every job that uses the material.
function rate(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 10000) / 10000 : null;
}

export async function GET(_request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!canDeptUseBOM(perms)) {
    return NextResponse.json({ error: 'Bill of Material access required' }, { status: 403 });
  }

  // The whole master in one go: a shop's material list is a few dozen rows
  // at most, and the dropdown filters it client-side.
  const { data, error } = await supabase
    .from('bom_materials')
    .select('*')
    .order('name');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // NUMERIC arrives as a number from PostgREST today; pin it anyway, since
  // the costing table compares and multiplies this on the client.
  const materials = (data ?? []).map((m) => ({ ...m, rate_per_sqm: Number(m.rate_per_sqm) }));

  return NextResponse.json({ materials });
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!perms || !canDeptDecideBOM(perms)) {
    return NextResponse.json(
      { error: 'Only Admin can add a material to the master list' },
      { status: 403 }
    );
  }

  const body = await request.json();

  const name = text(body.name);
  if (!name) return NextResponse.json({ error: 'Material name is required' }, { status: 400 });

  const ratePerSqm = rate(body.rate_per_sqm);
  if (ratePerSqm === null) {
    return NextResponse.json({ error: 'Enter the rate per square metre' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('bom_materials')
    .insert({
      name,
      specification: text(body.specification),
      rate_per_sqm:  ratePerSqm,
      is_active:     true,
      created_by:    user.email ?? perms.key,
      updated_by:    user.email ?? perms.key,
    })
    .select()
    .single();

  if (error) {
    // 23505 = the generated name_key collided: same material, different
    // spelling or casing. Point at the existing row rather than making two.
    if (error.code === '23505') {
      return NextResponse.json(
        { error: `${name} is already on the list — edit its rate instead` },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ material: data }, { status: 201 });
}
