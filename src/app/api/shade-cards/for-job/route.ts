// src/app/api/shade-cards/for-job/route.ts
// ============================================================
// GET /api/shade-cards/for-job?pm_code=&party=&product=
//   — the shade card(s) matching a job, for the cross-reference panel.
// ============================================================
// Display-only. Nothing here writes, and nothing about a shade card advances
// a job's stage: "Shade Card Sent" is a client-notification trigger stage
// (see src/app/api/jobs/[id]/status/route.ts), so letting an approval move it
// automatically would email customers as a side effect of a data edit.
//
// Matching is two-pass, because pm_code is missing on ~19% of the imported
// cards (562 of 3,014):
//
//   1. pm_code, case-insensitive — the reliable identifier when present.
//   2. party + product_name, case-insensitive — the fallback. Looser: two
//      products with near-identical names under one party can both match,
//      so the response says which rule fired and the UI labels it.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';

/** How the match was made, so the UI can be honest about its confidence. */
export type ShadeCardMatchBasis = 'pm_code' | 'party_product' | 'none';

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const pmCode  = searchParams.get('pm_code')?.trim() ?? '';
  const party   = searchParams.get('party')?.trim() ?? '';
  const product = searchParams.get('product')?.trim() ?? '';

  // Only ever the live version of a card: a superseded row describes a card
  // the party no longer holds.
  const base = () => supabase
    .from('shade_cards')
    .select('id, party, product_name, pm_code, shade_card_number, status, making_status, approval_date, updated_at')
    .eq('is_current', true)
    .limit(5);

  if (pmCode) {
    const { data, error } = await base().ilike('pm_code', pmCode);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (data && data.length > 0) {
      return NextResponse.json({ cards: data, basis: 'pm_code' satisfies ShadeCardMatchBasis });
    }
  }

  if (party && product) {
    const { data, error } = await base().ilike('party', party).ilike('product_name', product);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (data && data.length > 0) {
      return NextResponse.json({ cards: data, basis: 'party_product' satisfies ShadeCardMatchBasis });
    }
  }

  return NextResponse.json({ cards: [], basis: 'none' satisfies ShadeCardMatchBasis });
}
