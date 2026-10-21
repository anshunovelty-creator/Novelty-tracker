// src/app/api/job-separations/[id]/dispatch/route.ts
// POST /api/job-separations/[id]/dispatch { qty, confirm? } — record labels
// dispatched against this exact line, from the Job Separation worksheet.
//
// It's a dispatch entry like any other (pending_dispatch_notifications), so
// the worksheet, Reports and the Dispatch History tab all read one record:
// it counts at once (confirmed_at), skips the team-email queue (notified_at)
// and can be removed from History with a reason. Same checks as the dispatch
// form (lib/dispatchChecks.ts): 409 { warnings } until sent with confirm.
//
// Only a line its PO + PM code picks out on its own can take one — otherwise
// the entry would count against whichever line matching lands on.
// Needs dispatch_qty_view (the column itself) plus job_separation_edit or
// dispatch_notifications.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptManageJobSeparation, canDeptManageDispatchNotifications, canDeptSeeDispatchedQty } from '@/lib/constants/departments';
import { deptKeyOf } from '@/lib/identity';
import { containsPattern } from '@/lib/search';
import { dispatchWarnings } from '@/lib/dispatchChecks';
import { dispatchedByLine, lineFor } from '@/lib/dispatchLedger';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;

  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!canDeptSeeDispatchedQty(perms) || (!canDeptManageJobSeparation(perms) && !canDeptManageDispatchNotifications(perms))) {
    return NextResponse.json({ error: 'Your department can\'t record dispatches here. Admin grants it in Departments.' }, { status: 403 });
  }

  const body = await request.json();
  const qty = Number.isInteger(body.qty) ? Number(body.qty) : NaN;
  if (!(qty > 0)) return NextResponse.json({ error: 'Enter the labels dispatched, a whole number above 0' }, { status: 400 });

  const admin = createAdminClient();
  const { data: row, error: rowError } = await admin
    .from('job_separations')
    .select('id, party, po_no, pm_code, material_name, quantity, cancelled_at')
    .eq('id', id)
    .maybeSingle();
  if (rowError) return NextResponse.json({ error: rowError.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'This line no longer exists' }, { status: 404 });
  if (row.cancelled_at) return NextResponse.json({ error: 'This line is cancelled' }, { status: 409 });
  if (!row.po_no?.trim()) return NextResponse.json({ error: 'Add the PO number to this line first' }, { status: 409 });

  const pattern = containsPattern(row.po_no.trim());
  const { data: samePo, error: poError } = await admin
    .from('job_separations')
    .select('id, po_no, pm_code')
    .is('cancelled_at', null)
    .ilike('po_no', pattern);
  if (poError) return NextResponse.json({ error: poError.message }, { status: 500 });
  if (lineFor(row.po_no, row.pm_code, samePo)?.id !== row.id) {
    return NextResponse.json({
      error: 'Another line has the same PO and PM code, so a dispatch can\'t be tied to this one. Correct the PM code first.',
    }, { status: 409 });
  }

  if (body.confirm !== true) {
    try {
      const warnings = await dispatchWarnings(admin, { po: row.po_no, pm: row.pm_code, qty });
      if (warnings.length) return NextResponse.json({ warnings }, { status: 409 });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  const { data: counted, error: countedError } = await admin
    .from('pending_dispatch_notifications')
    .select('po_number, pm_code, qty')
    .not('confirmed_at', 'is', null)
    .is('removed_at', null)
    .ilike('po_number', pattern);
  if (countedError) return NextResponse.json({ error: countedError.message }, { status: 500 });
  const before = dispatchedByLine(samePo, counted).get(row.id) ?? 0;

  const now = new Date().toISOString();
  const { error } = await admin.from('pending_dispatch_notifications').insert({
    job_id:       null,
    job_name:     row.material_name,
    po_number:    row.po_no.trim(),
    party:        row.party,
    pm_code:      row.pm_code,
    qty,
    status:       row.quantity != null && before + qty < row.quantity ? 'Partial Dispatch' : 'Dispatched',
    remark:       'Entered on Job Separation',
    created_by:   user.email ?? deptKeyOf(user) ?? null,
    confirmed_at: now,
    notified_at:  now,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ dispatched: before + qty });
}
