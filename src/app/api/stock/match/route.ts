// src/app/api/stock/match/route.ts
// ============================================================
// GET /api/stock/match?pm_code=PM-4521
// Labels for this PM code already sitting on the shelf.
//
// Answers the question at the only moment it is worth money: while a
// repeat order is being typed in. Printing 50,000 when 12,000 identical
// labels are already on a rack is material, press time and labour spent
// for nothing, and nothing in the app surfaced that before.
//
// Matched on PM code alone, not PM code + party. The PM code identifies
// the label artwork, which is what has to be identical for the stock to
// be usable; party names are typed by hand and vary ("UPL" / "UPL Ltd").
// The party is returned so the caller can still see whose it is.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { LabelStock } from '@/lib/types';

// Enough to show the shelf without turning the callout into a table.
const MAX_ROWS = 20;

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const pmCode = new URL(request.url).searchParams.get('pm_code')?.trim() ?? '';

  // Short fragments would match half the shelf while someone is still
  // typing. Empty response, not an error — the caller polls as they type.
  if (pmCode.length < 2) {
    return NextResponse.json({ available: [], committed: [], available_qty: 0 });
  }

  // Exact code, but case-insensitively: 'pm-4521' and 'PM-4521' are the
  // same label. ilike with the wildcards escaped gives exactly that —
  // no trailing %, or PM-45 would pull in PM-4521.
  const literal = pmCode.replace(/[%_\\]/g, '\\$&');

  const { data, error } = await supabase
    .from('label_stock')
    .select('*')
    .eq('is_dispatched', false)
    .ilike('pm_code', literal)
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS);

  if (error) {
    console.error('[GET /api/stock/match]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as LabelStock[];

  // 'Remaining' is the unshipped balance of an order that is still open —
  // those labels are already promised to that job and must not be counted
  // as free. 'Extra' (over-run or reprint spares) and 'Manual' (stock
  // found on the shelf) belong to nobody, so they are the usable figure.
  const available = rows.filter((r) => r.kind === 'Extra' || r.kind === 'Manual');
  const committed = rows.filter((r) => r.kind === 'Remaining');

  return NextResponse.json({
    available,
    committed,
    available_qty: available.reduce((sum, r) => sum + r.qty, 0),
  });
}
