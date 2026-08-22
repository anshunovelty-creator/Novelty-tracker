// src/app/api/dispatch-notifications/[id]/route.ts
// PATCH  /api/dispatch-notifications/[id] — correct a queued (unsent) entry.
// DELETE /api/dispatch-notifications/[id] — remove a queued (unsent) entry.
// Dispatch/Admin only, same gating as the rest of this feature.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptManageDispatchNotifications } from '@/lib/constants/departments';

const MANUAL_STATUSES = ['Partial Dispatch', 'Dispatched'] as const;

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!canDeptManageDispatchNotifications(perms)) {
    return NextResponse.json({ error: 'Only Dispatch/Admin can edit dispatch entries' }, { status: 403 });
  }

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
    .is('notified_at', null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params;

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!canDeptManageDispatchNotifications(perms)) {
    return NextResponse.json({ error: 'Only Dispatch/Admin can remove dispatch entries' }, { status: 403 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from('pending_dispatch_notifications')
    .delete()
    .eq('id', id)
    .is('notified_at', null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
