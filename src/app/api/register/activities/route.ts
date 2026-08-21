// src/app/api/register/activities/route.ts
// ============================================================
// GET  /api/register/activities — the activity log, newest first.
// POST /api/register/activities — log a follow-up. This is the core
//        loop: logging what happened also moves the deal's stage and
//        sets its next action + date in the same call, mirroring the
//        original artifact's "Log follow-up" form (one submit does both).
// Admin only.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptManageRegister } from '@/lib/constants/departments';

const STAGES = ['enquiry', 'artwork', 'quotation', 'approval', 'po'] as const;

function text(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

async function requireAdmin() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!perms || !canDeptManageRegister(perms)) {
    return { error: NextResponse.json({ error: 'Register is Admin only' }, { status: 403 }) } as const;
  }
  return { user, perms, supabase } as const;
}

export async function GET(_request: NextRequest) {
  const gate = await requireAdmin();
  if ('error' in gate) return gate.error;

  const { data, error } = await gate.supabase
    .from('register_activities')
    .select('*')
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ activities: data ?? [] });
}

export async function POST(request: NextRequest) {
  const gate = await requireAdmin();
  if ('error' in gate) return gate.error;

  const body = await request.json();
  const accountId = text(body.account_id);
  const type = text(body.type);
  if (!accountId) return NextResponse.json({ error: 'Account is required' }, { status: 400 });
  if (!type) return NextResponse.json({ error: 'Say what happened' }, { status: 400 });

  const dealId = text(body.deal_id);
  const admin = createAdminClient();

  const { data: activity, error: activityError } = await admin
    .from('register_activities')
    .insert({
      account_id: accountId,
      deal_id:    dealId,
      date:       text(body.date) ?? new Date().toISOString().slice(0, 10),
      type,
      by:         text(body.by) ?? (gate.user.email ?? gate.perms.key),
      note:       text(body.note),
    })
    .select()
    .single();

  if (activityError) return NextResponse.json({ error: activityError.message }, { status: 500 });

  // A follow-up almost always moves the deal forward — same submit updates
  // it, so the team doesn't have to open the deal separately right after.
  let deal = null;
  if (dealId) {
    const dealUpdates: Record<string, unknown> = {};
    if ('stage' in body && (STAGES as readonly string[]).includes(body.stage)) dealUpdates.stage = body.stage;
    if ('next_action' in body) dealUpdates.next_action = text(body.next_action);
    if ('next_action_date' in body) dealUpdates.next_action_date = text(body.next_action_date);

    if (Object.keys(dealUpdates).length > 0) {
      const { data: updatedDeal, error: dealError } = await admin
        .from('register_deals')
        .update(dealUpdates)
        .eq('id', dealId)
        .select()
        .single();
      if (dealError) return NextResponse.json({ error: dealError.message }, { status: 500 });
      deal = updatedDeal;
    }
  }

  return NextResponse.json({ activity, deal }, { status: 201 });
}
