// src/app/api/dies/[id]/route.ts
// ============================================================
// PATCH  /api/dies/[id] — correct a die record. Prepress or Admin.
// DELETE /api/dies/[id] — remove one outright. Prepress or Admin.
//
// Delete is a hard delete: these rows are hand-typed off a paper sheet,
// so duplicates and mis-entries are common and nothing else in the
// schema points at a die.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptManageDiesPlates } from '@/lib/constants/departments';
import { DIE_STATUSES } from '@/lib/types';

type Params = { params: Promise<{ id: string }> };

const TEXT_FIELDS = [
  'length', 'width', 'material', 'gap', 'corner', 'serial_no', 'die_received_on', 'location',
] as const;

const INT_FIELDS = ['cylinder', 'ups'] as const;

// Returns the response to send back when the caller may not write, null when
// they may. Both verbs on this route gate identically.
async function denyWrite(): Promise<NextResponse | null> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!perms) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });

  if (!canDeptManageDiesPlates(perms)) {
    return NextResponse.json(
      { error: 'Only Prepress or Admin can change dies' },
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

  if ('job_name' in body) {
    const jobName = typeof body.job_name === 'string' ? body.job_name.trim() : '';
    if (!jobName) {
      return NextResponse.json({ error: 'Job name is required' }, { status: 400 });
    }
    updates.job_name = jobName;
  }

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

  // Status and its damage fields travel together: 'DAMAGE' requires both a
  // date and a reason, anything else clears them, so a die switched back to
  // 'IN USE' or 'EXTRA' never carries a stale damage record.
  if ('status' in body) {
    const raw = typeof body.status === 'string' ? body.status.trim() : '';
    if (!(DIE_STATUSES as string[]).includes(raw)) {
      return NextResponse.json({ error: 'Invalid die status' }, { status: 400 });
    }
    updates.status = raw;

    if (raw === 'DAMAGE') {
      const damageDate   = typeof body.damage_date === 'string' ? body.damage_date.trim() : '';
      const damageReason = typeof body.damage_reason === 'string' ? body.damage_reason.trim() : '';
      if (!damageDate || !damageReason) {
        return NextResponse.json(
          { error: 'Damage date and reason are required when status is Damage' },
          { status: 400 },
        );
      }
      updates.damage_date   = damageDate;
      updates.damage_reason = damageReason;
    } else {
      updates.damage_date   = null;
      updates.damage_reason = null;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('dies')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: `Serial no ${updates.serial_no} is already on another die` },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Die not found' }, { status: 404 });

  return NextResponse.json({ die: data });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;

  const denied = await denyWrite();
  if (denied) return denied;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('dies')
    .delete()
    .eq('id', id)
    .select('id');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: 'Die not found' }, { status: 404 });

  return NextResponse.json({ ok: true });
}
