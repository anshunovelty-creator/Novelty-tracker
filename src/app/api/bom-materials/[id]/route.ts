// src/app/api/bom-materials/[id]/route.ts
// ============================================================
// PATCH  /api/bom-materials/[id] — rename, re-rate, or retire/restore one
//        material. bom_decide.
// DELETE /api/bom-materials/[id] — remove it outright. bom_decide, and only
//        if no costing or request points at it: the DB says RESTRICT, and
//        this route says why before the DB has to.
//
// Changing a rate reprices every job costed with the material — expense is
// never stored on the costing, always computed from the master. That is
// deliberate (a typo in the rate is fixed once), and it is also why a
// retired material keeps its rate: the old jobs still need to price.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptDecideBOM } from '@/lib/constants/departments';

type Params = { params: Promise<{ id: string }> };

function text(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

function rate(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 10000) / 10000 : null;
}

async function requireDecide() {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;
  }
  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!perms || !canDeptDecideBOM(perms)) {
    return {
      error: NextResponse.json(
        { error: 'Only Admin can change the material master' },
        { status: 403 }
      ),
    } as const;
  }
  return { user, perms } as const;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;

  const gate = await requireDecide();
  if ('error' in gate) return gate.error;

  const body = await request.json();
  const patch: Record<string, unknown> = {
    updated_by: gate.user.email ?? gate.perms.key,
  };

  // Only the fields actually sent change — a rate edit must not blank the
  // specification, and a retire toggle must not touch the rate.
  if ('name' in body) {
    const name = text(body.name);
    if (!name) return NextResponse.json({ error: 'Material name is required' }, { status: 400 });
    patch.name = name;
  }
  if ('specification' in body) patch.specification = text(body.specification);
  if ('rate_per_sqm' in body) {
    const ratePerSqm = rate(body.rate_per_sqm);
    if (ratePerSqm === null) {
      return NextResponse.json({ error: 'Enter a valid rate per square metre' }, { status: 400 });
    }
    patch.rate_per_sqm = ratePerSqm;
  }
  if ('is_active' in body) patch.is_active = Boolean(body.is_active);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('bom_materials')
    .update(patch)
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'Another material already has that name' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Material not found' }, { status: 404 });

  return NextResponse.json({ material: data });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;

  const gate = await requireDecide();
  if ('error' in gate) return gate.error;

  const admin = createAdminClient();

  // A material a job has been costed with is history, not clutter. Retire
  // it instead so the old jobs keep pricing and the dropdown stops offering it.
  const { count, error: countError } = await admin
    .from('bom_costings')
    .select('job_separation_id', { count: 'exact', head: true })
    .eq('material_id', id);

  if (countError) return NextResponse.json({ error: countError.message }, { status: 500 });
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      {
        error: `${count} job${count === 1 ? ' is' : 's are'} costed with this material — retire it instead of deleting`,
      },
      { status: 409 }
    );
  }

  const { error } = await admin.from('bom_materials').delete().eq('id', id);
  if (error) {
    // 23503 = foreign key: something else (a request snapshot) still points
    // here. Same answer as above.
    if (error.code === '23503') {
      return NextResponse.json(
        { error: 'This material is referenced by a request — retire it instead of deleting' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
