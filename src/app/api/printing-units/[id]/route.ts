// src/app/api/printing-units/[id]/route.ts
// ============================================================
// PATCH  /api/printing-units/[id]  — rename / change method / retire
// DELETE /api/printing-units/[id]  — hard delete (Admin only)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions } from '@/lib/constants/departments';
import { PRINTING_METHODS, type PrintingMethod } from '@/lib/types';

interface Params {
  params: Promise<{ id: string }>;
}

/** Both handlers are Admin-only; returns null when authorised. */
async function requireAdmin() {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!perms?.isSuperAdmin) {
    return NextResponse.json(
      { error: 'Only Admin can manage printing units' },
      { status: 403 },
    );
  }
  return null;
}

// ── PATCH ─────────────────────────────────────────────────────
export async function PATCH(request: NextRequest, { params }: Params) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  const body = await request.json() as {
    name?: string;
    printing_method?: PrintingMethod;
    sort_order?: number;
    is_active?: boolean;
  };

  // Build the patch from only the keys actually supplied, so a partial
  // update never blanks a field the caller did not mention.
  const patch: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) {
      return NextResponse.json({ error: 'Unit name cannot be empty' }, { status: 400 });
    }
    patch.name = name;
  }

  if (body.printing_method !== undefined) {
    if (!PRINTING_METHODS.includes(body.printing_method)) {
      return NextResponse.json(
        { error: `Printing method must be one of: ${PRINTING_METHODS.join(', ')}` },
        { status: 400 },
      );
    }
    patch.printing_method = body.printing_method;
  }

  if (body.sort_order !== undefined) patch.sort_order = body.sort_order;
  if (body.is_active !== undefined)  patch.is_active  = body.is_active;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('printing_units')
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('[PATCH /api/printing-units/[id]]', error);
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'A unit with that name already exists' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Unit not found' }, { status: 404 });
  }

  return NextResponse.json({ unit: data });
}

// ── DELETE ────────────────────────────────────────────────────
export async function DELETE(_request: NextRequest, { params }: Params) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  const admin = createAdminClient();

  // Warn rather than block: the FK is ON DELETE SET NULL, so deleting a
  // unit silently unassigns every job on it. Report the count so the UI
  // can say exactly how many jobs are about to lose their unit.
  const { count } = await admin
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('printing_unit_id', id);

  const { error } = await admin.from('printing_units').delete().eq('id', id);

  if (error) {
    console.error('[DELETE /api/printing-units/[id]]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, jobs_unassigned: count ?? 0 });
}
