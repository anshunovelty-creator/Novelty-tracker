// src/app/api/shade-cards/[id]/route.ts
// ============================================================
// GET    /api/shade-cards/:id  — one card, its status trail and its lineage
// PATCH  /api/shade-cards/:id  — edit fields, approval status, or making state
// POST   /api/shade-cards/:id  — supersede it with a new revision
// DELETE /api/shade-cards/:id  — remove it (super admin only)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { getDeptPermissions, canDeptManageShadeCards } from '@/lib/constants/departments';
import { isSelectableStatus, isMakingStatus } from '@/lib/constants/shadeCards';

type Params = { params: Promise<{ id: string }> };

function optionalText(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

function optionalDate(value: unknown): string | null {
  const s = optionalText(value);
  if (!s) return null;
  return Number.isNaN(Date.parse(s)) ? null : s;
}

function actorName(user: { email?: string; user_metadata?: Record<string, unknown> }): string {
  const meta = user.user_metadata ?? {};
  const full = typeof meta.full_name === 'string' ? meta.full_name.trim() : '';
  return full || user.email || 'Unknown';
}

/** The editable field set, shared by PATCH (edit) and POST (revise). */
function readFields(body: Record<string, unknown>) {
  return {
    party:              optionalText(body.party),
    product_name:       optionalText(body.product_name),
    pm_code:            optionalText(body.pm_code),
    shade_card_number:  optionalText(body.shade_card_number),
    docket_number:      optionalText(body.docket_number),
    prepared_date:      optionalDate(body.prepared_date),
    approval_date:      optionalDate(body.approval_date),
    sent_to_party_date: optionalDate(body.sent_to_party_date),
    received_back_date: optionalDate(body.received_back_date),
    qnap_path:          optionalText(body.qnap_path),
    notes:              optionalText(body.notes),
  };
}

/** Session + department gate shared by every mutating handler here. */
async function requireManager() {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!perms) return { error: NextResponse.json({ error: 'Invalid department' }, { status: 403 }) };
  if (!canDeptManageShadeCards(perms)) {
    return { error: NextResponse.json({ error: 'Your department cannot change shade cards' }, { status: 403 }) };
  }
  return { supabase, user, perms };
}

// ── GET ───────────────────────────────────────────────────────
export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: card, error } = await supabase
    .from('shade_cards').select('*').eq('id', id).maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!card) return NextResponse.json({ error: 'Shade card not found' }, { status: 404 });

  // The trail is append-only and written by trigger, so it is the record of
  // what actually happened rather than what the UI believes happened.
  const { data: history } = await supabase
    .from('shade_card_status_history')
    .select('*')
    .eq('shade_card_id', id)
    .order('changed_at', { ascending: false });

  // The version this one replaced, and the one that replaced it — enough to
  // step through the lineage one hop at a time in either direction.
  const { data: supersededBy } = await supabase
    .from('shade_cards')
    .select('id, version')
    .eq('supersedes_id', id)
    .maybeSingle();

  return NextResponse.json({
    card,
    history: history ?? [],
    supersededBy: supersededBy ?? null,
  });
}

// ── PATCH ─────────────────────────────────────────────────────
// One of three actions, chosen explicitly rather than inferred from which
// keys happen to be present — status and making_status each have their own
// rule, and guessing would let a field edit quietly change an approval.
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const gate = await requireManager();
  if (gate.error) return gate.error;
  const { supabase, user } = gate;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const name = actorName(user);
  const action = body.action;

  const { data: existing } = await supabase
    .from('shade_cards').select('making_status').eq('id', id).maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Shade card not found' }, { status: 404 });

  let patch: Record<string, unknown>;

  if (action === 'status') {
    if (!isSelectableStatus(body.status)) {
      return NextResponse.json({ error: 'Select a valid status' }, { status: 400 });
    }
    // The DB trigger writes the history row; nothing to record here.
    patch = { status: body.status };

  } else if (action === 'making') {
    if (!isMakingStatus(body.making_status)) {
      return NextResponse.json({ error: 'Select a valid making status' }, { status: 400 });
    }
    // "Already Made" is one-way — a physical card that exists cannot stop
    // existing. Enforced here, not merely hidden in the UI.
    if (existing.making_status === 'Already Made' && body.making_status === 'Pending') {
      return NextResponse.json(
        { error: "This shade card is already made — it can't be moved back to pending." },
        { status: 409 },
      );
    }
    patch = { making_status: body.making_status };

  } else if (action === 'fields') {
    const fields = readFields(body);
    if (!fields.party)        return NextResponse.json({ error: 'Party is required' }, { status: 400 });
    if (!fields.product_name) return NextResponse.json({ error: 'Product name is required' }, { status: 400 });
    // Same one-way rule as above: a field edit must not quietly downgrade a
    // card that has already been made.
    const making_status = existing.making_status === 'Already Made'
      ? 'Already Made'
      : (isMakingStatus(body.making_status) ? body.making_status : 'Pending');
    patch = { ...fields, making_status };

  } else {
    return NextResponse.json(
      { error: "action must be one of 'fields', 'status' or 'making'" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from('shade_cards')
    .update({ ...patch, updated_by: user.id, updated_by_name: name })
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ card: data });
}

// ── POST (revise) ─────────────────────────────────────────────
// Supersede the card with a new version. The new row is inserted first, so a
// failure part-way leaves the lineage with a current row rather than none.
export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const gate = await requireManager();
  if (gate.error) return gate.error;
  const { supabase, user } = gate;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const fields = readFields(body);
  if (!fields.party)        return NextResponse.json({ error: 'Party is required' }, { status: 400 });
  if (!fields.product_name) return NextResponse.json({ error: 'Product name is required' }, { status: 400 });

  const { data: oldRow, error: readErr } = await supabase
    .from('shade_cards').select('id, version, status, is_current').eq('id', id).maybeSingle();

  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!oldRow) return NextResponse.json({ error: 'Shade card not found' }, { status: 404 });
  if (!oldRow.is_current) {
    return NextResponse.json(
      { error: 'This version has already been superseded — revise the current one instead.' },
      { status: 409 },
    );
  }

  const name = actorName(user);

  // The revision inherits the approval status: revising a card does not
  // re-open an approval that the party already gave.
  const { data: newRow, error: insertErr } = await supabase
    .from('shade_cards')
    .insert({
      ...fields,
      making_status:   isMakingStatus(body.making_status) ? body.making_status : 'Pending',
      status:          oldRow.status,
      version:         (oldRow.version ?? 1) + 1,
      is_current:      true,
      supersedes_id:   id,
      created_by:      user.id,
      created_by_name: name,
      updated_by:      user.id,
      updated_by_name: name,
    })
    .select()
    .single();

  if (insertErr || !newRow) {
    return NextResponse.json({ error: insertErr?.message ?? 'Failed to create revision' }, { status: 500 });
  }

  const { error: flagErr } = await supabase
    .from('shade_cards').update({ is_current: false }).eq('id', id);

  if (flagErr) {
    // The new version exists and is current, so the card is usable — but two
    // rows now claim to be current and the list will show both. Say so
    // plainly rather than reporting a clean success.
    return NextResponse.json({
      card: newRow,
      warning: 'The revision was created, but the previous version could not be retired. '
             + 'Both versions will appear in the list until an admin corrects it.',
    }, { status: 207 });
  }

  return NextResponse.json({ card: newRow }, { status: 201 });
}

// ── DELETE ────────────────────────────────────────────────────
// Super admin only, matching the source app where Prepress and QC could do
// everything to a card except remove it. Hard delete: the status history
// cascades with it.
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!perms?.isSuperAdmin) {
    return NextResponse.json({ error: 'Only an admin can delete a shade card' }, { status: 403 });
  }

  const { error } = await supabase.from('shade_cards').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
