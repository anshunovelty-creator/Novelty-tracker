// src/app/api/bom-requests/[id]/items/[itemId]/route.ts
// ============================================================
// PATCH /api/bom-requests/[id]/items/[itemId] — the owner's answer on one
//       material line: order it, order less of it, swap it, or refuse it.
//       Admin only.
//
// The decision lives on the line, not the request, because "order the paper
// but not the foil, and use 100gsm instead of 90" is the normal answer, not
// an edge case. The request's own status is recomputed from these lines by
// the rollup_bom_request_status trigger — this route never writes it.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptDecideBOM } from '@/lib/constants/departments';
import type { BomDecision } from '@/lib/types';

type Params = { params: Promise<{ id: string; itemId: string }> };

const DECISIONS = ['pending', 'ordered', 'partial', 'alternative', 'rejected'] as const;

function text(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

function decimal(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id, itemId } = await params;

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(user.user_metadata?.department);
  // Production raises and reads, but the buying decision is the owner's.
  if (!perms || !canDeptDecideBOM(perms)) {
    return NextResponse.json(
      { error: 'Only Admin can decide a material request' },
      { status: 403 }
    );
  }

  const body = await request.json();
  const decision = body.decision;

  if (!(DECISIONS as readonly string[]).includes(decision)) {
    return NextResponse.json(
      { error: 'Pick one of: ordered, partial, alternative, rejected' },
      { status: 400 }
    );
  }

  const approvedQuantity    = decimal(body.approved_quantity);
  const alternativeMaterial = text(body.alternative_material);
  const decisionNote        = text(body.decision_note);

  // Each decision carries the one field that makes it mean anything. The DB
  // deliberately doesn't CHECK these pairings (it would block a half-filled
  // row mid-edit), so this is the only place they're enforced.
  if (decision === 'partial' && approvedQuantity === null) {
    return NextResponse.json(
      { error: 'Say how much you are ordering for a partial order' },
      { status: 400 }
    );
  }
  if (decision === 'alternative' && !alternativeMaterial) {
    return NextResponse.json(
      { error: 'Name the alternative material to use instead' },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Scope by request id as well as item id: a mismatched pair is a bug in
  // the caller, and answering the wrong line silently would be worse than
  // a 404.
  const { data: existing, error: findError } = await admin
    .from('bom_request_items')
    .select('id, request_id')
    .eq('id', itemId)
    .eq('request_id', id)
    .maybeSingle();

  if (findError) return NextResponse.json({ error: findError.message }, { status: 500 });
  if (!existing) {
    return NextResponse.json({ error: 'Material line not found on this request' }, { status: 404 });
  }

  const clearing = decision === 'pending';

  const { data, error } = await admin
    .from('bom_request_items')
    .update({
      decision: decision as BomDecision,
      // Only the field this decision needs survives; the others are cleared
      // so a line switched from 'partial' to 'ordered' doesn't keep a stale
      // approved quantity hanging off it.
      approved_quantity:    decision === 'partial' ? approvedQuantity : null,
      alternative_material: decision === 'alternative' ? alternativeMaterial : null,
      decision_note:        clearing ? null : decisionNote,
      decided_at:           clearing ? null : new Date().toISOString(),
      decided_by:           clearing ? null : (user.email ?? perms.key),
    })
    .eq('id', itemId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Hand back the whole request: the trigger has just recomputed its status
  // and the client needs the new header state, not only the changed line.
  const { data: parent, error: parentError } = await admin
    .from('bom_requests')
    .select('*, items:bom_request_items(*)')
    .eq('id', id)
    .single();

  if (parentError) {
    // The decision itself landed — degrade to returning just the line rather
    // than reporting a failure the user would wrongly retry.
    console.error('bom_requests refetch after decision failed:', parentError);
    return NextResponse.json({ item: data });
  }

  return NextResponse.json({ item: data, request: parent });
}
