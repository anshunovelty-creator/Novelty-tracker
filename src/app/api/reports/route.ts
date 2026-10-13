// src/app/api/reports/route.ts
// ============================================================
// GET /api/reports — the Reports page's rows (Admin only).
// ============================================================
//
// Every Job Separation row, cancelled ones included, in the lean shape
// lib/reports.ts analyses. The page slices by period, unit and party on its
// own, so one fetch serves every view. Shade cards come along for the
// colour approval section: only those started since the first order day,
// since an older card's PO isn't on Job Separation.
//
// ponytail: whole table to the client — ~500 rows a month is ~1 MB a year.
// Past ~20k rows, move analyse() into SQL (a grouped RPC) and send only the
// aggregates.

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions } from '@/lib/constants/departments';
import { istToday } from '@/lib/jobViews';
import { allPages } from '@/lib/api/allPages';
import { deptKeyOf } from '@/lib/identity';
import { earliestDay, type SepRow, type ShadeCard } from '@/lib/reports';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!perms?.isSuperAdmin) {
    return NextResponse.json({ error: 'Only Admin can see reports' }, { status: 403 });
  }

  const admin = createAdminClient();
  let raw;
  try {
    raw = await allPages((from, to) => admin
      .from('job_separations')
      .select('id, sr_no, po_date, created_at, party, po_no, pm_code, material_name, quantity, unit, rate, order_value, jc_status, aw_send_to, cancelled_at')
      .order('id', { ascending: true })
      .range(from, to));
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

  const since = earliestDay(rows);
  let cards: ShadeCard[] = [];
  if (since) {
    const { data, error } = await admin
      .from('shade_cards')
      .select('id, party, product_name, pm_code, status, prepared_date, sent_to_party_date, approval_date')
      .eq('is_current', true)
      .or(`sent_to_party_date.gte.${since},and(sent_to_party_date.is.null,prepared_date.gte.${since})`);
    if (error) {
      console.error('[GET /api/reports] shade cards', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    cards = data.map((c) => ({
      id: c.id, party: c.party ?? '', product: c.product_name, pm_code: c.pm_code, status: c.status,
      prepared: c.prepared_date, sent: c.sent_to_party_date, approved: c.approval_date,
    }));
  }

  return NextResponse.json({ rows, cards, today: istToday() });
}
