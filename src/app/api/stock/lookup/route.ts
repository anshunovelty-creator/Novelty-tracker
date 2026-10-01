// src/app/api/stock/lookup/route.ts
// ============================================================
// GET /api/stock/lookup?q= — find the order a manual stock entry belongs
//                            to, in Job Separation (stock_edit only).
//
// Job Separation, not the dashboard's jobs: stock usually outlives the
// job card — leftovers of an order long since closed, or of a PO that never
// got a job card at all — and the worksheet holds every PO. The PO and PM
// code match ignoring case, spaces, hyphens and slashes (po_norm / pm_norm,
// migration 071), so "pomsnd26270557" finds "POMSND2627-0557".
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptManageStock } from '@/lib/constants/departments';
import { orContains } from '@/lib/search';

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!canDeptManageStock(perms)) {
    return NextResponse.json({ error: 'Your department cannot add label stock' }, { status: 403 });
  }

  const q = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) return NextResponse.json({ separations: [] });

  // Letters and digits only — safe to place in the filter unquoted.
  const norm = q.toLowerCase().replace(/[^a-z0-9]/g, '');
  const clauses = [orContains(['sr_no', 'party', 'material_name'], q)];
  if (norm) clauses.push(`po_norm.ilike.%${norm}%`, `pm_norm.ilike.%${norm}%`);

  const { data, error } = await createAdminClient()
    .from('job_separations')
    .select('id, sr_no, party, po_no, pm_code, material_name, quantity, linked_job_id, linked_job_card_number')
    .is('cancelled_at', null)
    .or(clauses.join(','))
    .order('created_at', { ascending: false })
    .limit(8);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ separations: data ?? [] });
}
