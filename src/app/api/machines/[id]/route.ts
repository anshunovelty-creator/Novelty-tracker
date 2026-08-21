// src/app/api/machines/[id]/route.ts
// ============================================================
// PATCH  — rename / relocate / mark fault (is_active) (Production/Admin).
// DELETE — remove a machine: hard-delete if it was never used, otherwise
//          retire it (hidden from the board, printing history preserved).
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireDept } from '@/lib/api/machineBoard';
import { canDeptManageMachineBoard } from '@/lib/constants/departments';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const auth = await requireDept();
  if ('error' in auth) return auth.error;
  if (!canDeptManageMachineBoard(auth.perms)) {
    return NextResponse.json(
      { error: 'Only Production or Admin can update machines' },
      { status: 403 }
    );
  }

  const body = await request.json();
  const update: Record<string, unknown> = {};
  if (typeof body.name === 'string' && body.name.trim()) update.name = body.name.trim();
  if ('location' in body) {
    update.location = typeof body.location === 'string' && body.location.trim()
      ? body.location.trim()
      : null;
  }
  if (typeof body.is_active === 'boolean') update.is_active = body.is_active;

  // Run rate: a positive whole number, or null to clear it. Requires migration
  // 010 — before that the update fails with a "column does not exist" message.
  if ('labels_per_hour' in body) {
    const raw = body.labels_per_hour;
    if (raw === null || raw === '') {
      update.labels_per_hour = null;
    } else {
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) {
        return NextResponse.json(
          { error: 'labels_per_hour must be a whole number greater than zero' },
          { status: 400 }
        );
      }
      update.labels_per_hour = n;
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: machine, error } = await admin
    .from('machines')
    .update(update)
    .eq('id', id)
    .select()
    .single();

  if (error || !machine) {
    return NextResponse.json({ error: error?.message ?? 'Machine not found' }, { status: 404 });
  }
  return NextResponse.json({ machine });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const auth = await requireDept();
  if ('error' in auth) return auth.error;
  if (!canDeptManageMachineBoard(auth.perms)) {
    return NextResponse.json(
      { error: 'Only Production or Admin can remove machines' },
      { status: 403 }
    );
  }

  const admin = createAdminClient();

  const { count } = await admin
    .from('machine_queue_items')
    .select('id', { count: 'exact', head: true })
    .eq('machine_id', id);

  if ((count ?? 0) > 0) {
    // Machine has queue entries / history — retire instead of deleting so
    // "what was printed on which machine" stays answerable forever.
    const { error } = await admin
      .from('machines')
      .update({ is_retired: true })
      .eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ retired: true });
  }

  const { error } = await admin.from('machines').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
