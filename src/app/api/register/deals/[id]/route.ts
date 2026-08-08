// src/app/api/register/deals/[id]/route.ts
// ============================================================
// PATCH  /api/register/deals/[id] — edit a deal's fields, and/or change
//        its status. Body is a partial update: only the keys present are
//        touched. Setting status to 'won' or 'lost' stamps closed_at with
//        today's server date (never trusts a client-supplied date) and,
//        for 'lost', records why.
// DELETE /api/register/deals/[id] — remove a deal and its activity log
//        (cascades via FK ON DELETE CASCADE).
// Admin only.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseDepartment, canDeptManageRegister } from '@/lib/constants/departments';

type Params = { params: Promise<{ id: string }> };
const STAGES = ['enquiry', 'artwork', 'quotation', 'approval', 'po'] as const;

function text(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}
function decimal(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function requireAdmin() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;

  const dept = parseDepartment(user.user_metadata?.department);
  if (!canDeptManageRegister(dept)) {
    return { error: NextResponse.json({ error: 'Register is Admin only' }, { status: 403 }) } as const;
  }
  return { user, dept } as const;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const gate = await requireAdmin();
  if ('error' in gate) return gate.error;

  const body = await request.json();
  const updates: Record<string, unknown> = {};

  if ('title' in body) {
    const title = text(body.title);
    if (!title) return NextResponse.json({ error: 'Describe the job or enquiry' }, { status: 400 });
    updates.title = title;
  }
  if ('stage' in body && (STAGES as readonly string[]).includes(body.stage)) updates.stage = body.stage;
  if ('owner' in body) updates.owner = text(body.owner);
  if ('qty' in body) updates.qty = text(body.qty);
  if ('value' in body) updates.value = decimal(body.value);
  if ('substrate' in body) updates.substrate = text(body.substrate);
  if ('next_action' in body) updates.next_action = text(body.next_action);
  if ('next_action_date' in body) updates.next_action_date = text(body.next_action_date);
  if ('account_id' in body) updates.account_id = text(body.account_id);

  if (body.status === 'won') {
    updates.status = 'won';
    updates.closed_at = new Date().toISOString().slice(0, 10);
  } else if (body.status === 'lost') {
    updates.status = 'lost';
    updates.closed_at = new Date().toISOString().slice(0, 10);
    updates.lost_reason = text(body.lost_reason);
  } else if (body.status === 'open') {
    // Reopening — clears the close-out fields so a re-opened deal doesn't
    // show a stale won/lost date.
    updates.status = 'open';
    updates.closed_at = null;
    updates.lost_reason = null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('register_deals')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deal: data });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const gate = await requireAdmin();
  if ('error' in gate) return gate.error;

  const admin = createAdminClient();
  const { data, error } = await admin.from('register_deals').delete().eq('id', id).select('id');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
