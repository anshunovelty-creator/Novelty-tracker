// src/app/api/shade-cards/summary/route.ts
// ============================================================
// GET /api/shade-cards/summary — register-wide counts for the KPI tiles.
// ============================================================
// Deliberately unfiltered: these describe the state of the whole register,
// not the current search. The tiles double as filter shortcuts, and "Approved:
// 1,240" only means something if it counts every approved card rather than
// however many happen to match what is typed in the search box.
//
// Four HEAD counts rather than one grouped query: `count: 'exact', head: true`
// sends no rows back, and migration 055 indexed both status and making_status,
// so each is an index-only count over ~3,000 rows. A GROUP BY would need an
// RPC — a migration and a second place to keep statuses in sync — to save
// three cheap round trips.

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export type ShadeCardSummary = {
  total:             number;
  approved:          number;
  pending_approval:  number;
  /** Entries created in the last rolling 7×24h — recent intake, not a backlog. */
  added_last_7_days: number;
  /** The exact cutoff the count above used, ISO-8601. The client passes this
   *  back as ?created_from= so the filtered list is the same set the tile
   *  counted — recomputing "7 days ago" on the client would drift by however
   *  long the round trip took, and could differ by a card near the boundary. */
  added_since:       string;
};

export async function GET() {
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Superseded rows are history — the register only ever counts live cards,
  // matching what the list itself shows.
  const base = () => supabase
    .from('shade_cards')
    .select('*', { count: 'exact', head: true })
    .eq('is_current', true);

  // Rolling window, not "since Monday": the question this answers is "how much
  // has come in lately", which a week boundary would reset to zero every
  // Monday morning. created_at is NOT NULL and the import preserved the real
  // dates, so it reads correctly over historical rows too.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [total, approved, pending, recent] = await Promise.all([
    base(),
    base().eq('status', 'Approved'),
    base().eq('status', 'Pending Approval'),
    base().gte('created_at', sevenDaysAgo),
  ]);

  const failed = [total, approved, pending, recent].find((r) => r.error);
  if (failed?.error) {
    return NextResponse.json({ error: failed.error.message }, { status: 500 });
  }

  return NextResponse.json({
    total:             total.count    ?? 0,
    approved:          approved.count ?? 0,
    pending_approval:  pending.count  ?? 0,
    added_last_7_days: recent.count   ?? 0,
    added_since:       sevenDaysAgo,
  } satisfies ShadeCardSummary);
}
