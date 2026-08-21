// src/app/api/stock/[id]/route.ts
// ============================================================
// PATCH /api/stock/[id] — mark stock dispatched, or correct its
//                         quantity / location / remark.
//                         Dispatch or Admin only.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptManageStock } from '@/lib/constants/departments';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!perms) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });

  if (!canDeptManageStock(perms)) {
    return NextResponse.json(
      { error: 'Only Dispatch or Admin can update stock' },
      { status: 403 }
    );
  }

  const body = await request.json();
  const updates: Record<string, unknown> = {};

  // Marking dispatched is one-way. Stock that left the building coming back
  // onto the shelf is a new arrival, not an undo — it gets its own row, so
  // the history stays a truthful sequence of events.
  if (body.is_dispatched === true) {
    updates.is_dispatched = true;
    updates.dispatched_at = new Date().toISOString();
    updates.dispatched_by = user.email ?? perms.key;
  }

  if ('qty' in body) {
    const qty = Number(body.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      return NextResponse.json({ error: 'Quantity must be a positive number' }, { status: 400 });
    }
    updates.qty = qty;
  }

  if ('location' in body) {
    updates.location = typeof body.location === 'string' ? body.location.trim() || null : null;
  }
  if ('remark' in body) {
    updates.remark = typeof body.remark === 'string' ? body.remark.trim() || null : null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('label_stock')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data)  return NextResponse.json({ error: 'Stock entry not found' }, { status: 404 });

  return NextResponse.json({ stock: data });
}
