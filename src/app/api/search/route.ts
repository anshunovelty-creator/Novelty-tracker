// src/app/api/search/route.ts
// ============================================================
// GET /api/search?q=riverline — the Ctrl K palette's "search everything".
// ============================================================
//
// One request, six small lists: jobs, plates, roto and flatbed dies, label
// stock on the shelf, and parties. Each is capped, because the palette is
// for jumping to a thing, not browsing — the page it opens has the full list.
//
// Same visibility as each section's own GET: jobs, plates, dies and parties
// are open to any signed-in user; label stock only to departments that can
// see stock (and RLS on label_stock enforces that again).

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { getDeptPermissions, canDeptViewStock } from '@/lib/constants/departments';
import { containsPattern, orContains } from '@/lib/search';
import { deptKeyOf } from '@/lib/identity';

const LIMIT = 5;

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const q = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  // One letter matches half the database; wait for something specific.
  if (q.length < 2) {
    return NextResponse.json({ jobs: [], plates: [], dies: [], flatbed: [], stock: [], parties: [] });
  }

  const perms = await getDeptPermissions(deptKeyOf(user));
  const canSeeStock = canDeptViewStock(perms);

  const [jobs, plates, dies, flatbed, stock, parties] = await Promise.all([
    supabase
      .from('jobs')
      .select('id, job_card_number, po_number, party, job_name, pm_code, status, delivery_date, is_closed')
      .or(orContains(['job_card_number', 'po_number', 'party', 'job_name', 'pm_code'], q))
      // Open jobs first, then the newest — a repeat order beats last year's.
      .order('is_closed', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(LIMIT),
    supabase
      .from('plates')
      .select('id, plate_id, party, pm_code, item_name, cylinder, location')
      .or(orContains(['party', 'pm_code', 'item_name', 'plate_id'], q))
      .order('created_at', { ascending: false })
      .limit(LIMIT),
    supabase
      .from('dies')
      .select('id, serial_no, job_name, length, width, status, location')
      .or(orContains(['job_name', 'serial_no', 'location'], q))
      .order('created_at', { ascending: false })
      .limit(LIMIT),
    supabase
      .from('flatbed_dies')
      .select('id, serial_no, length, width, shape, location')
      .or(orContains(['location', 'shape'], q))
      .order('created_at', { ascending: false })
      .limit(LIMIT),
    canSeeStock
      ? supabase
          .from('label_stock')
          .select('id, kind, party, job_name, pm_code, job_card_number, qty, location')
          .eq('is_dispatched', false)
          .or(orContains(['job_card_number', 'po_number', 'pm_code', 'party', 'job_name', 'location'], q))
          .order('created_at', { ascending: false })
          .limit(LIMIT)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('parties')
      .select('id, name')
      .ilike('name', containsPattern(q))
      .order('name')
      .limit(LIMIT),
  ]);

  const failed = [jobs, plates, dies, flatbed, stock, parties].find((r) => r.error);
  if (failed?.error) {
    console.error('[GET /api/search]', failed.error);
    return NextResponse.json({ error: failed.error.message }, { status: 500 });
  }

  return NextResponse.json({
    jobs:    jobs.data    ?? [],
    plates:  plates.data  ?? [],
    dies:    dies.data    ?? [],
    flatbed: flatbed.data ?? [],
    stock:   stock.data   ?? [],
    parties: parties.data ?? [],
  });
}
