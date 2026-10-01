// src/app/api/stock/[id]/route.ts
// ============================================================
// PATCH  /api/stock/[id] — dispatch some or all of a stock row out, or
//                          correct it (qty / location / remark, and the
//                          identity fields of a row not tied to a job).
// DELETE /api/stock/[id] — remove a row entered by mistake.
//                          Dispatch or Admin only.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptManageStock } from '@/lib/constants/departments';

type Params = { params: Promise<{ id: string }> };

/** Shared gate: signed in, and in a department that may move stock. */
async function authorise(verb: string) {
  const supabase = await createServerSupabaseClient();

  const user = await getClaimsUser(supabase);
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!perms) return { error: NextResponse.json({ error: 'Invalid department' }, { status: 403 }) };

  if (!canDeptManageStock(perms)) {
    return {
      error: NextResponse.json({ error: `Only Dispatch or Admin can ${verb} stock` }, { status: 403 }),
    };
  }
  return { actor: user.email ?? perms.key };
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() || null : null);

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const auth = await authorise('update');
  if (auth.error) return auth.error;
  const { actor } = auth;

  const body  = await request.json();
  const admin = createAdminClient();

  const { data: row, error: readErr } = await admin
    .from('label_stock')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!row)    return NextResponse.json({ error: 'Stock entry not found' }, { status: 404 });

  // ── Dispatch out ──────────────────────────────────────────────
  // One-way. Stock that left the building coming back onto the shelf is a
  // new arrival, not an undo — it gets its own row, so the history stays a
  // truthful sequence of events.
  //
  // dispatch_qty < qty is a part dispatch: the shipped labels split off into
  // their own dispatched row (same identity, same "added" date) and the
  // balance stays on the shelf. is_dispatched: true is the whole row.
  if (body.is_dispatched === true || 'dispatch_qty' in body) {
    if (row.is_dispatched) {
      return NextResponse.json({ error: 'This stock is already dispatched' }, { status: 409 });
    }

    const out = 'dispatch_qty' in body ? Number(body.dispatch_qty) : row.qty;
    if (!Number.isInteger(out) || out <= 0) {
      return NextResponse.json({ error: 'Dispatched quantity must be a whole number above 0' }, { status: 400 });
    }
    if (out > row.qty) {
      return NextResponse.json(
        { error: `Only ${row.qty} labels are in this stock — cannot dispatch ${out}` },
        { status: 400 },
      );
    }

    const dispatched = {
      is_dispatched: true,
      dispatched_at: new Date().toISOString(),
      dispatched_by: actor,
    };

    if (out === row.qty) {
      const { data, error } = await admin
        .from('label_stock')
        .update(dispatched)
        .eq('id', id)
        .eq('is_dispatched', false)
        .select()
        .maybeSingle();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data)  return NextResponse.json({ error: 'Stock changed meanwhile — reload and try again' }, { status: 409 });
      return NextResponse.json({ stock: data, dispatched: null });
    }

    // Part dispatch. Record what went out first, then take it off the
    // shelf row — guarded on the qty we read, so two people dispatching
    // from the same pile at once cannot both spend the same labels.
    const { id: _id, updated_at: _u, ...identity } = row;
    const { data: split, error: insErr } = await admin
      .from('label_stock')
      .insert({ ...identity, ...dispatched, qty: out })
      .select()
      .single();
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

    const { data: balance, error: updErr } = await admin
      .from('label_stock')
      .update({ qty: row.qty - out })
      .eq('id', id)
      .eq('qty', row.qty)
      .eq('is_dispatched', false)
      .select()
      .maybeSingle();

    if (updErr || !balance) {
      await admin.from('label_stock').delete().eq('id', split.id);
      return updErr
        ? NextResponse.json({ error: updErr.message }, { status: 500 })
        : NextResponse.json({ error: 'Stock changed meanwhile — reload and try again' }, { status: 409 });
    }

    return NextResponse.json({ stock: balance, dispatched: split });
  }

  // ── Corrections ───────────────────────────────────────────────
  const updates: Record<string, unknown> = {};

  if ('qty' in body) {
    const qty = Number(body.qty);
    if (!Number.isInteger(qty) || qty <= 0) {
      return NextResponse.json({ error: 'Quantity must be a whole number above 0' }, { status: 400 });
    }
    updates.qty = qty;
  }
  if ('location' in body) updates.location = text(body.location);
  if ('remark'   in body) updates.remark   = text(body.remark);

  // Identity is a snapshot of the job when there is one — editing it here
  // would make the row disagree with its job. A row with no job is only
  // what someone typed, so typos in it are fair to fix.
  if (!row.job_id) {
    if ('party' in body) {
      const party = text(body.party);
      if (!party) return NextResponse.json({ error: 'Party is required' }, { status: 400 });
      updates.party = party;
    }
    if ('job_name' in body) updates.job_name = text(body.job_name);
    if ('pm_code'  in body) updates.pm_code  = text(body.pm_code);
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const { data, error } = await admin
    .from('label_stock')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ stock: data });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const auth = await authorise('delete');
  if (auth.error) return auth.error;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('label_stock')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data)  return NextResponse.json({ error: 'Stock entry not found' }, { status: 404 });

  return NextResponse.json({ ok: true });
}
