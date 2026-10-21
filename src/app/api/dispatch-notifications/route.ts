// src/app/api/dispatch-notifications/route.ts
// GET /api/dispatch-notifications — pending dispatch events grouped by
// party, for the "Dispatch Emails" panel. Dispatch/Admin only.
// GET ?view=history — every entry that has left the queue, been team-emailed
// or been removed, newest first, with the order line it matched.
// POST /api/dispatch-notifications — add a manual, free-text entry (no
// backing job) for a dispatch that happened outside the normal flow.
// Answers 409 { warnings } (lib/dispatchChecks.ts) until sent again with
// confirm: true.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptManageDispatchNotifications } from '@/lib/constants/departments';
import type { PendingDispatchNotification, PendingDispatchGroup, DispatchHistoryRow } from '@/lib/types';
import { deptKeyOf } from '@/lib/identity';
import { allPages } from '@/lib/api/allPages';
import { lineFor, poKey } from '@/lib/dispatchLedger';
import { dispatchWarnings } from '@/lib/dispatchChecks';

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
      .is('notified_at', null)
      .is('removed_at', null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const parties = new Set((data ?? []).map((r: { party: string }) => r.party));
    return NextResponse.json({ pending: parties.size });
  }

  if (request.nextUrl.searchParams.get('view') === 'history') return history();

  const { data, error } = await admin
    .from('pending_dispatch_notifications')
    .select('*')
    .is('notified_at', null)
    .is('removed_at', null)
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

// ponytail: reads the whole entry table and order book per request (a few
// thousand rows a year); page by date range if that grows past ~10k.
async function history() {
  const admin = createAdminClient();
  let entries: PendingDispatchNotification[], lines: { id: string; sr_no: string | null; po_no: string | null; pm_code: string | null; quantity: number | null }[];
  try {
    [entries, lines] = await Promise.all([
      allPages<PendingDispatchNotification>((from, to) => admin.from('pending_dispatch_notifications').select('*')
        .order('created_at', { ascending: false }).order('id').range(from, to)),
      allPages<(typeof lines)[number]>((from, to) => admin.from('job_separations').select('id, sr_no, po_no, pm_code, quantity')
        .is('cancelled_at', null).order('id').range(from, to)),
    ]);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  const byPo = new Map<string, typeof lines>();
  for (const l of lines) {
    const k = poKey(l.po_no);
    if (k) byPo.set(k, [...(byPo.get(k) ?? []), l]);
  }
  const lineOf = (e: PendingDispatchNotification) => lineFor(e.po_number, e.pm_code, byPo.get(poKey(e.po_number)) ?? []);

  // Every live entry, sent or still queued, adds to its line's total.
  const entered = new Map<string, number>();
  for (const e of entries) {
    const l = !e.removed_at && lineOf(e);
    if (l) entered.set(l.id, (entered.get(l.id) ?? 0) + (e.qty ?? 0));
  }

  const rows: DispatchHistoryRow[] = entries
    .filter((e) => e.notified_at || e.confirmed_at || e.removed_at)
    .map((e) => {
      const l = lineOf(e);
      return { ...e, line: l ? { sr_no: l.sr_no, quantity: l.quantity, entered: entered.get(l.id) ?? 0 } : null };
    });
  return NextResponse.json({ rows });
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
  if (body.confirm !== true) {
    try {
      const warnings = await dispatchWarnings(admin, { po: poNumber, pm: pmCode || null, qty });
      if (warnings.length) return NextResponse.json({ warnings }, { status: 409 });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

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
      created_by: user.email ?? deptKeyOf(user) ?? null,
    });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ added: true });
}
