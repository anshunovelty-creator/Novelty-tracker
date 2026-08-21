// src/app/api/register/deals/route.ts
// ============================================================
// GET  /api/register/deals — list deals, newest first.
// POST /api/register/deals — add a deal (an enquiry against an account).
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
function decimal(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function stage(value: unknown): string {
  return typeof value === 'string' && (STAGES as readonly string[]).includes(value) ? value : 'enquiry';
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
    .from('register_deals')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deals: data ?? [] });
}

export async function POST(request: NextRequest) {
  const gate = await requireAdmin();
  if ('error' in gate) return gate.error;

  const body = await request.json();
  const accountId = text(body.account_id);
  const title = text(body.title);
  if (!accountId) return NextResponse.json({ error: 'Account is required' }, { status: 400 });
  if (!title) return NextResponse.json({ error: 'Describe the job or enquiry' }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('register_deals')
    .insert({
      account_id:       accountId,
      title,
      stage:            stage(body.stage),
      owner:            text(body.owner),
      qty:              text(body.qty),
      value:            decimal(body.value),
      substrate:        text(body.substrate),
      next_action:      text(body.next_action),
      next_action_date: text(body.next_action_date),
      created_by:       gate.user.email ?? gate.perms.key,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deal: data }, { status: 201 });
}
