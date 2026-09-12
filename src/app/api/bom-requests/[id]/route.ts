// src/app/api/bom-requests/[id]/route.ts
// ============================================================
// PATCH  /api/bom-requests/[id] — the owner's answer, or the floor's
//        change of mind. { action, note? }
//          order    → 'ordered'    bom_decide
//          decline  → 'declined'   bom_decide
//          reopen   → 'pending'    bom_decide  (undo a mis-click)
//          withdraw → 'cancelled'  bom_use, only while still pending
// DELETE /api/bom-requests/[id] — remove it outright. bom_decide, for
//        mis-entries and test rows; withdraw/decline keep the paper trail.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptUseBOM, canDeptDecideBOM } from '@/lib/constants/departments';
import { BOM_JOB_SUMMARY_SELECT } from '@/lib/bom';
import type { BomRequestStatus } from '@/lib/types';

type Params = { params: Promise<{ id: string }> };

const ACTIONS = ['order', 'decline', 'reopen', 'withdraw'] as const;
type Action = typeof ACTIONS[number];

const NEXT_STATUS: Record<Action, BomRequestStatus> = {
  order:    'ordered',
  decline:  'declined',
  reopen:   'pending',
  withdraw: 'cancelled',
};

function text(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

async function requireBomAccess() {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;
  }

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!canDeptUseBOM(perms)) {
    return {
      error: NextResponse.json({ error: 'Bill of Material access required' }, { status: 403 }),
    } as const;
  }

  return { user, perms: perms!, supabase } as const;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;

  const gate = await requireBomAccess();
  if ('error' in gate) return gate.error;

  const body = await request.json();
  const action = body.action as Action;

  if (!(ACTIONS as readonly string[]).includes(action)) {
    return NextResponse.json(
      { error: "Unsupported action — use 'order', 'decline', 'reopen' or 'withdraw'" },
      { status: 400 }
    );
  }

  // The buying decision (and undoing it) is the owner's; withdrawing an
  // unanswered request is the floor's.
  if (action !== 'withdraw' && !canDeptDecideBOM(gate.perms)) {
    return NextResponse.json({ error: 'Only Admin can answer a material request' }, { status: 403 });
  }

  const admin = createAdminClient();

  const { data: existing, error: findError } = await admin
    .from('bom_material_requests')
    .select('id, status')
    .eq('id', id)
    .maybeSingle();

  if (findError) return NextResponse.json({ error: findError.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: 'Request not found' }, { status: 404 });

  if (action === 'withdraw' && existing.status !== 'pending') {
    return NextResponse.json(
      { error: 'Only a request nobody has answered yet can be withdrawn' },
      { status: 409 }
    );
  }
  if (action === 'reopen' && existing.status === 'pending') {
    return NextResponse.json({ error: 'That request is already open' }, { status: 409 });
  }

  const actor = gate.user.email ?? gate.perms.key;
  const decided = action === 'order' || action === 'decline';

  const { data, error } = await admin
    .from('bom_material_requests')
    .update({
      status:        NEXT_STATUS[action],
      // A decision carries its note and stamp; reopening or withdrawing
      // clears them so a stale "ordered on Tuesday" never sits under
      // a pending chip.
      decision_note: decided ? text(body.note) : null,
      decided_at:    decided ? new Date().toISOString() : null,
      decided_by:    decided ? actor : null,
    })
    .eq('id', id)
    .select(`*, ${BOM_JOB_SUMMARY_SELECT}`)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ request: data });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;

  const gate = await requireBomAccess();
  if ('error' in gate) return gate.error;

  if (!canDeptDecideBOM(gate.perms)) {
    return NextResponse.json(
      { error: 'Only Admin can delete a request — withdraw it instead' },
      { status: 403 }
    );
  }

  const admin = createAdminClient();
  const { error } = await admin.from('bom_material_requests').delete().eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
