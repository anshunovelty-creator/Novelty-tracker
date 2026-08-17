// src/app/api/flatbed-dies/[id]/route.ts
// ============================================================
// PATCH  /api/flatbed-dies/[id] — correct a flatbed die record. Prepress or Admin.
// DELETE /api/flatbed-dies/[id] — remove one outright. Prepress or Admin.
//
// Mirrors /api/dies/[id] exactly, scoped to flatbed_dies' smaller field set.
// Delete is a hard delete — same reasoning as dies: hand-typed records,
// nothing else in the schema points at one.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseDepartment, canDeptManageDiesPlates } from '@/lib/constants/departments';

type Params = { params: Promise<{ id: string }> };

const TEXT_FIELDS = [
  'length', 'width', 'gap', 'corner', 'shape', 'location', 'die_received_on',
] as const;

const INT_FIELDS = ['ups'] as const;

// Returns the response to send back when the caller may not write, null when
// they may. Both verbs on this route gate identically.
async function denyWrite(): Promise<NextResponse | null> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dept = parseDepartment(user.user_metadata?.department);
  if (!dept) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });

  if (!canDeptManageDiesPlates(dept)) {
    return NextResponse.json(
      { error: 'Only Prepress or Admin can change flatbed dies' },
      { status: 403 }
    );
  }

  return null;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;

  const denied = await denyWrite();
  if (denied) return denied;

  const body = await request.json();
  const updates: Record<string, unknown> = {};

  for (const field of TEXT_FIELDS) {
    if (field in body) {
      updates[field] = typeof body[field] === 'string' ? body[field].trim() || null : null;
    }
  }

  for (const field of INT_FIELDS) {
    if (field in body) {
      const raw = body[field];
      const n = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
      updates[field] = Number.isFinite(n) ? Math.trunc(n) : null;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('flatbed_dies')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Flatbed die not found' }, { status: 404 });

  return NextResponse.json({ flatbed_die: data });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;

  const denied = await denyWrite();
  if (denied) return denied;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('flatbed_dies')
    .delete()
    .eq('id', id)
    .select('id');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: 'Flatbed die not found' }, { status: 404 });

  return NextResponse.json({ ok: true });
}
