// src/app/api/bom-requests/[id]/route.ts
// ============================================================
// PATCH  /api/bom-requests/[id] — withdraw a request, or reopen one that
//        was withdrawn by mistake. Production or Admin.
// DELETE /api/bom-requests/[id] — remove it outright. Admin only.
//
// Withdrawing is the normal "never mind" — the request stays on the record
// with its history, which is the point of moving this off email. Deleting
// is for mis-entries only and is Admin's call alone; the items go with it
// via ON DELETE CASCADE.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseDepartment, canDeptUseBOM, canDeptDecideBOM } from '@/lib/constants/departments';

type Params = { params: Promise<{ id: string }> };

async function requireBomAccess() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;
  }

  const dept = parseDepartment(user.user_metadata?.department);
  if (!canDeptUseBOM(dept)) {
    return {
      error: NextResponse.json(
        { error: 'Bill of Material is Production and Admin only' },
        { status: 403 }
      ),
    } as const;
  }

  return { user, dept: dept!, supabase } as const;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;

  const gate = await requireBomAccess();
  if ('error' in gate) return gate.error;

  const body = await request.json();
  const action = body.action;

  if (action !== 'cancel' && action !== 'reopen') {
    return NextResponse.json(
      { error: "Unsupported action — use 'cancel' or 'reopen'" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { data: existing, error: findError } = await admin
    .from('bom_requests')
    .select('id, status')
    .eq('id', id)
    .maybeSingle();

  if (findError) return NextResponse.json({ error: findError.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: 'Request not found' }, { status: 404 });

  if (action === 'cancel') {
    // Once the owner has started answering lines, withdrawing it wholesale
    // would strand those decisions — at that point it's a conversation to
    // have, not a button to press.
    if (existing.status !== 'pending') {
      return NextResponse.json(
        { error: 'Only a request nobody has acted on yet can be withdrawn' },
        { status: 409 }
      );
    }

    const { data, error } = await admin
      .from('bom_requests')
      .update({
        status:       'cancelled',
        cancelled_at: new Date().toISOString(),
        cancelled_by: gate.user.email ?? gate.dept,
      })
      .eq('id', id)
      .select('*, items:bom_request_items(*)')
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ request: data });
  }

  // Reopen: the rollup trigger only ever skips 'cancelled' rows, so putting
  // this back to 'pending' hands it straight back to the normal flow. Items
  // are untouched — a withdrawn request can't have decided ones.
  if (existing.status !== 'cancelled') {
    return NextResponse.json(
      { error: 'Only a withdrawn request can be reopened' },
      { status: 409 }
    );
  }

  const { data, error } = await admin
    .from('bom_requests')
    .update({ status: 'pending', cancelled_at: null, cancelled_by: null })
    .eq('id', id)
    .select('*, items:bom_request_items(*)')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ request: data });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;

  const gate = await requireBomAccess();
  if ('error' in gate) return gate.error;

  // Production withdraws; only Admin erases. Keeps the paper trail intact
  // for everything except genuine mis-entries.
  if (!canDeptDecideBOM(gate.dept)) {
    return NextResponse.json(
      { error: 'Only Admin can delete a request — withdraw it instead' },
      { status: 403 }
    );
  }

  const admin = createAdminClient();
  const { error } = await admin.from('bom_requests').delete().eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
