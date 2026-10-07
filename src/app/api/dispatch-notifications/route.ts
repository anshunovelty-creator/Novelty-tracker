// src/app/api/dispatch-notifications/route.ts
// GET /api/dispatch-notifications — pending dispatch events grouped by
// party, for the "Dispatch Emails" panel. Dispatch/Admin only.
// POST /api/dispatch-notifications — add a manual, free-text entry (no
// backing job) for a dispatch that happened outside the normal flow.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptManageDispatchNotifications } from '@/lib/constants/departments';
import type { PendingDispatchNotification, PendingDispatchGroup } from '@/lib/types';
import { deptKeyOf } from '@/lib/identity';

const MANUAL_STATUSES = ['Partial Dispatch', 'Dispatched'] as const;

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!canDeptManageDispatchNotifications(perms)) {
    return NextResponse.json({ error: 'Only Dispatch/Admin can view dispatch notifications' }, { status: 403 });
  }

  const admin = createAdminClient();

  // ?count=pending — just the number of parties with a batch waiting, for
  // the header badge. Reads only the party column (served by the partial
  // idx_pending_dispatch_notifications_pending index) instead of shipping
  // every pending row to the client to count groups there.
  if (request.nextUrl.searchParams.get('count') === 'pending') {
    const { data, error } = await admin
      .from('pending_dispatch_notifications')
      .select('party')
      .is('notified_at', null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const parties = new Set((data ?? []).map((r: { party: string }) => r.party));
    return NextResponse.json({ pending: parties.size });
  }

  const { data, error } = await admin
    .from('pending_dispatch_notifications')
    .select('*')
    .is('notified_at', null)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as PendingDispatchNotification[];
  const groups = new Map<string, PendingDispatchNotification[]>();
  for (const row of rows) {
    const list = groups.get(row.party) ?? [];
    list.push(row);
    groups.set(row.party, list);
  }

  const result: PendingDispatchGroup[] = Array.from(groups.entries())
    .map(([party, items]) => ({ party, items }))
    .sort((a, b) => a.party.localeCompare(b.party));

  // How many contacts each party has on file — the queue marks a party with
  // none as not ready, since its email would have nowhere to go.
  if (result.length > 0) {
    const { data: contacts } = await admin
      .from('party_contacts')
      .select('party, email')
      .in('party', result.map((g) => g.party));
    const counts = new Map<string, number>();
    for (const c of (contacts ?? []) as { party: string; email: string | null }[]) {
      if (c.email) counts.set(c.party, (counts.get(c.party) ?? 0) + 1);
    }
    for (const g of result) g.contact_count = counts.get(g.party) ?? 0;
  }

  return NextResponse.json({ groups: result });
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!canDeptManageDispatchNotifications(perms)) {
    return NextResponse.json({ error: 'Only Dispatch/Admin can add dispatch entries' }, { status: 403 });
  }

  const body = await request.json();
  const party     = typeof body.party === 'string' ? body.party.trim() : '';
  const poNumber  = typeof body.po_number === 'string' ? body.po_number.trim() : '';
  const jobName   = typeof body.job_name === 'string' ? body.job_name.trim() : '';
  const remark    = typeof body.remark === 'string' ? body.remark.trim() : '';
  const pmCode    = typeof body.pm_code === 'string' ? body.pm_code.trim() : '';
  const status    = body.status;
  const qty       = Number.isFinite(body.qty) ? Number(body.qty) : null;

  if (!party)                                        return NextResponse.json({ error: 'Party is required' }, { status: 400 });
  if (!poNumber)                                      return NextResponse.json({ error: 'PO number is required' }, { status: 400 });
  if (!MANUAL_STATUSES.includes(status))              return NextResponse.json({ error: 'Status must be Partial Dispatch or Dispatched' }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin
    .from('pending_dispatch_notifications')
    .insert({
      job_id:    null,
      job_name:  jobName || null,
      po_number: poNumber,
      party,
      status,
      qty,
      remark:    remark || null,
      pm_code:   pmCode || null,
    });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ added: true });
}
