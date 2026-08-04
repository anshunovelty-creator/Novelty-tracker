// src/app/api/plates/[id]/route.ts
// ============================================================
// PATCH  /api/plates/[id] — correct any field on a plate record
// DELETE /api/plates/[id] — remove a plate record outright
//                           Prepress or Admin only.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseDepartment, canDeptManageDiesPlates } from '@/lib/constants/departments';

type Params = { params: Promise<{ id: string }> };

const TEXT_FIELDS = [
  'pm_code',
  'item_name',
  'across_size',
  'around_size',
  'plate_id',
  'plate_date',
  'location',
] as const;

const INT_FIELDS = ['cylinder', 'label_per_round'] as const;

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dept = parseDepartment(user.user_metadata?.department);
  if (!dept) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });

  if (!canDeptManageDiesPlates(dept)) {
    return NextResponse.json(
      { error: 'Only Prepress or Admin can update plates' },
      { status: 403 }
    );
  }

  const body = await request.json();
  const updates: Record<string, unknown> = {};

  if ('party' in body) {
    const party = typeof body.party === 'string' ? body.party.trim() : '';
    if (!party) return NextResponse.json({ error: 'Party is required' }, { status: 400 });
    updates.party = party;
  }

  for (const field of TEXT_FIELDS) {
    if (field in body) {
      updates[field] = typeof body[field] === 'string' ? body[field].trim() || null : null;
    }
  }

  for (const field of INT_FIELDS) {
    if (field in body) {
      const raw = body[field];
      if (raw === null || raw === undefined || raw === '') {
        updates[field] = null;
      } else {
        const n = Number(raw);
        if (!Number.isFinite(n)) {
          return NextResponse.json(
            { error: `${field.replace(/_/g, ' ')} must be a number` },
            { status: 400 }
          );
        }
        updates[field] = Math.trunc(n);
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('plates')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'A plate with that plate ID already exists' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Plate not found' }, { status: 404 });

  return NextResponse.json({ plate: data });
}

// Hard delete. These rows are typed by hand and duplicates happen; nothing
// else in the schema points at a plate, so there is no history to preserve.
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dept = parseDepartment(user.user_metadata?.department);
  if (!dept) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });

  if (!canDeptManageDiesPlates(dept)) {
    return NextResponse.json(
      { error: 'Only Prepress or Admin can delete plates' },
      { status: 403 }
    );
  }

  const admin = createAdminClient();
  const { error } = await admin.from('plates').delete().eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
