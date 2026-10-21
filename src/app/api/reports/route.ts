// src/app/api/reports/route.ts
// ============================================================
// GET /api/reports — the Reports page's rows (Admin only).
// ============================================================
//
// Every Job Separation row, cancelled ones included, in the lean shape
// lib/reports.ts analyses. The page slices by period, unit and party on its
// own, so one fetch serves every view. Shade cards come along for the
// colour approval section: only those started since the first order day,
// since an older card's PO isn't on Job Separation. Dispatch entries that
// count come along too, in full every time (lib/dispatchLedger.ts).
//
// ?since=<cursor>: only rows written since (updated_at, a couple of minutes
// earlier for slow commits — lib/reportSync.ts). The page loads everything
// once, then only changes. Every answer carries report_fingerprint(), the
// database's own per-month totals, which the page checks its copy against.
//
// ponytail: the first load is still the whole table (~500 rows a month).
// Past ~20k rows, keep the page's copy in IndexedDB so a new visit starts
// from a delta too.

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions } from '@/lib/constants/departments';
import { istToday } from '@/lib/jobViews';
import { allPages } from '@/lib/api/allPages';
import { deptKeyOf } from '@/lib/identity';
import type { SepRow, ShadeCard } from '@/lib/reports';
import type { DispatchEntry } from '@/lib/dispatchLedger';
import { OVERLAP_MS, type MonthPrint, type Fetched } from '@/lib/reportSync';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!perms?.isSuperAdmin) {
    return NextResponse.json({ error: 'Only Admin can see reports' }, { status: 403 });
  }

  const since = new URL(req.url).searchParams.get('since');
  if (since !== null && Number.isNaN(Date.parse(since))) {
    return NextResponse.json({ error: 'since must be a timestamp' }, { status: 400 });
  }

  const admin = createAdminClient();
  let raw, print: MonthPrint[];
  try {
    // Totals first: a write landing between the two reads then shows up as
    // rows the totals don't count yet, which the next sync settles.
    const fp = await admin.rpc('report_fingerprint');
    if (fp.error) throw new Error(fp.error.message);
    print = (fp.data as { month: string; lines: number; cancelled: number; value: string | number; qty: number }[])
      .map((p) => ({ month: p.month, lines: Number(p.lines), cancelled: Number(p.cancelled), value: Number(p.value), qty: Number(p.qty) }));
    raw = await allPages((from, to) => {
      let q = admin
        .from('job_separations')
        .select('id, sr_no, po_date, created_at, updated_at, party, po_no, pm_code, material_name, quantity, unit, rate, order_value, jc_status, aw_send_to, cancelled_at');
      if (since) q = q.gte('updated_at', new Date(Date.parse(since) - OVERLAP_MS).toISOString());
      return q.order('id', { ascending: true }).range(from, to);
    });
  } catch (err) {
    console.error('[GET /api/reports]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  // numeric columns arrive as strings from PostgREST when they overflow a
  // JS number's safe range; Number() covers both.
  const n = (x: unknown) => (x == null ? null : Number(x));
  const rows: SepRow[] = raw.map((r) => ({
    id: r.id, sr_no: r.sr_no,
    day: r.po_date ?? istToday(new Date(r.created_at)),
    party: r.party, po_no: r.po_no, pm_code: r.pm_code, material_name: r.material_name,
    quantity: n(r.quantity), unit: r.unit, rate: n(r.rate), order_value: n(r.order_value),
    jc_status: r.jc_status, aw_send_to: r.aw_send_to,
    cancelled: r.cancelled_at != null,
  }));

  // Cards from the order book's first month; the page trims to its first day.
  const first = print[0] ? `${print[0].month}-01` : null;
  let cards: ShadeCard[] = [];
  if (first) {
    const { data, error } = await admin
      .from('shade_cards')
      .select('id, party, product_name, pm_code, status, prepared_date, sent_to_party_date, approval_date')
      .eq('is_current', true)
      .or(`sent_to_party_date.gte.${first},and(sent_to_party_date.is.null,prepared_date.gte.${first})`);
    if (error) {
      console.error('[GET /api/reports] shade cards', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    cards = data.map((c) => ({
      id: c.id, party: c.party ?? '', product: c.product_name, pm_code: c.pm_code, status: c.status,
      prepared: c.prepared_date, sent: c.sent_to_party_date, approved: c.approval_date,
    }));
  }

  // Dispatch entries that count (confirmed, not removed), every sync in full:
  // a few thousand a year, and they change without touching Job Separation.
  let dispatches: DispatchEntry[];
  try {
    const entries = await allPages<{ id: string; party: string; po_number: string; pm_code: string | null; qty: number | null; confirmed_at: string }>((from, to) => admin
      .from('pending_dispatch_notifications')
      .select('id, party, po_number, pm_code, qty, confirmed_at')
      .not('confirmed_at', 'is', null)
      .is('removed_at', null)
      .order('id', { ascending: true })
      .range(from, to));
    dispatches = entries.map((d) => ({ id: d.id, party: d.party, po: d.po_number, pm: d.pm_code, qty: d.qty ?? 0, day: istToday(new Date(d.confirmed_at)) }));
  } catch (err) {
    console.error('[GET /api/reports] dispatches', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  const cursor = raw.reduce<string | null>((m, r) => (!m || r.updated_at > m ? r.updated_at : m), since);
  const body: Fetched = { full: !since, rows, cursor, print, cards, dispatches, today: istToday() };
  return NextResponse.json(body);
}
