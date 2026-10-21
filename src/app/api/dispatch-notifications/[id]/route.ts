// src/app/api/dispatch-notifications/[id]/route.ts
// PATCH  /api/dispatch-notifications/[id] — correct a queued (unsent) entry.
//        A changed PO, PM code or qty is checked like a new entry (409
//        { warnings } until sent again with confirm: true).
// DELETE /api/dispatch-notifications/[id] — remove an entry. One that never
//        counted (still queued, never team-emailed) is deleted outright; one
//        that counts is struck out with who, when and { reason }, and stays
//        in the history (migration 085).
// POST   /api/dispatch-notifications/[id] — confirm by hand that an entry
//        went out, for one cleared from the queue without a team email. It
//        counts from the day it was cleared (or entered), not today, so an
//        old dispatch doesn't land in this month's figures.
// Dispatch/Admin only, same gating as the rest of this feature.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptManageDispatchNotifications } from '@/lib/constants/departments';
import { deptKeyOf } from '@/lib/identity';
import { dispatchWarnings } from '@/lib/dispatchChecks';
import { poKey } from '@/lib/dispatchLedger';
import { pmKey } from '@/lib/reports';

const MANUAL_STATUSES = ['Partial Dispatch', 'Dispatched'] as const;

type Params = { params: Promise<{ id: string }> };

async function authorise(action: string) {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!canDeptManageDispatchNotifications(perms)) {
    return { error: NextResponse.json({ error: `Only Dispatch/Admin can ${action} dispatch entries` }, { status: 403 }) };
  }
  return { who: user.email ?? deptKeyOf(user) ?? 'unknown' };
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const auth = await authorise('edit');
  if (auth.error) return auth.error;

  const body = await request.json();
  const party    = typeof body.party === 'string' ? body.party.trim() : '';
  const poNumber = typeof body.po_number === 'string' ? body.po_number.trim() : '';
  const jobName  = typeof body.job_name === 'string' ? body.job_name.trim() : '';
  const remark   = typeof body.remark === 'string' ? body.remark.trim() : '';
  const pmCode   = typeof body.pm_code === 'string' ? body.pm_code.trim() : '';
  const status   = body.status;
  const qty      = Number.isFinite(body.qty) ? Number(body.qty) : null;

  if (!party)                               return NextResponse.json({ error: 'Party is required' }, { status: 400 });
  if (!poNumber)                             return NextResponse.json({ error: 'PO number is required' }, { status: 400 });
  if (!MANUAL_STATUSES.includes(status))     return NextResponse.json({ error: 'Status must be Partial Dispatch or Dispatched' }, { status: 400 });

  const admin = createAdminClient();
  const { data: before, error: readError } = await admin
    .from('pending_dispatch_notifications')
    .select('po_number, pm_code, qty')
    .eq('id', id)
    .is('notified_at', null)
    .is('removed_at', null)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  if (!before)   return NextResponse.json({ error: 'This entry has already left the queue' }, { status: 409 });

  // Only a change to what counts is checked: saving the vehicle number on a
  // flagged entry shouldn't ask again.
  const changed = poKey(before.po_number) !== poKey(poNumber) || pmKey(before.pm_code) !== pmKey(pmCode) || before.qty !== qty;
  if (changed && body.confirm !== true) {
    try {
      const warnings = await dispatchWarnings(admin, { po: poNumber, pm: pmCode || null, qty, excludeId: id });
      if (warnings.length) return NextResponse.json({ warnings }, { status: 409 });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  const { error } = await admin
    .from('pending_dispatch_notifications')
    .update({
      job_name:  jobName || null,
      po_number: poNumber,
      party,
      status,
      qty,
      remark:    remark || null,
      pm_code:   pmCode || null,
    })
    .eq('id', id)
    .is('notified_at', null)
    .is('removed_at', null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const auth = await authorise('remove');
  if (auth.error) return auth.error;

  const admin = createAdminClient();
  const { data: entry, error: readError } = await admin
    .from('pending_dispatch_notifications')
    .select('notified_at, confirmed_at, removed_at')
    .eq('id', id)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  if (!entry || entry.removed_at) return NextResponse.json({ error: 'This entry is already removed' }, { status: 404 });

  if (!entry.notified_at && !entry.confirmed_at) {
    const { error } = await admin
      .from('pending_dispatch_notifications')
      .delete()
      .eq('id', id)
      .is('notified_at', null)
      .is('confirmed_at', null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, removed: 'deleted' });
  }

  const body = await request.json().catch(() => ({}));
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason) return NextResponse.json({ error: 'Say why this entry is being removed' }, { status: 400 });

  const { error } = await admin
    .from('pending_dispatch_notifications')
    .update({ removed_at: new Date().toISOString(), removed_by: auth.who, remove_reason: reason })
    .eq('id', id)
    .is('removed_at', null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, removed: 'struck' });
}

export async function POST(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const auth = await authorise('confirm');
  if (auth.error) return auth.error;

  const admin = createAdminClient();
  const { data: entry, error: readError } = await admin
    .from('pending_dispatch_notifications')
    .select('created_at, notified_at')
    .eq('id', id)
    .is('confirmed_at', null)
    .is('removed_at', null)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  if (!entry) return NextResponse.json({ error: 'Already confirmed or removed' }, { status: 409 });

  const { error } = await admin
    .from('pending_dispatch_notifications')
    .update({ confirmed_at: entry.notified_at ?? entry.created_at })
    .eq('id', id)
    .is('confirmed_at', null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
