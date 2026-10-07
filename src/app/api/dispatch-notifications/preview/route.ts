// src/app/api/dispatch-notifications/preview/route.ts
// ============================================================
// GET /api/dispatch-notifications/preview?party=Tapi%20Pharma
// The party email exactly as Send would build it right now — recipients,
// subject and HTML — for the live preview beside the Dispatch emails queue.
// Built by the same template functions the send route uses, so what is
// previewed is what goes. Read-only: nothing is sent or marked.
// Dispatch/Admin only, same gating as the rest of this feature.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptManageDispatchNotifications } from '@/lib/constants/departments';
import { getConsolidatedEmailHTML, getConsolidatedSubject, type DispatchItem } from '@/lib/notifications/dispatchEmailTemplate';
import { LOGO_CID } from '@/lib/notifications/logoDataUri';
import type { PendingDispatchNotification } from '@/lib/types';
import { deptKeyOf } from '@/lib/identity';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!canDeptManageDispatchNotifications(perms)) {
    return NextResponse.json({ error: 'Only Dispatch/Admin can view dispatch notifications' }, { status: 403 });
  }

  const party = request.nextUrl.searchParams.get('party')?.trim() ?? '';
  if (!party) return NextResponse.json({ error: 'party is required' }, { status: 400 });

  const admin = createAdminClient();
  const [{ data: pending, error }, { data: contacts }] = await Promise.all([
    admin.from('pending_dispatch_notifications').select('*').eq('party', party).is('notified_at', null).order('created_at', { ascending: true }),
    admin.from('party_contacts').select('email, contact_name').eq('party', party),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const items: DispatchItem[] = ((pending ?? []) as PendingDispatchNotification[]).map((i) => ({
    job_name: i.job_name, po_number: i.po_number, status: i.status, qty: i.qty, remark: i.remark, pm_code: i.pm_code,
  }));
  const to = (contacts ?? []).map((c) => c.email).filter((e): e is string => Boolean(e));
  const contactName = contacts?.length === 1 ? contacts[0].contact_name : null;

  // The real email embeds the logo as an inline attachment (cid:); a browser
  // preview can't resolve that, so point it at the bundled file instead.
  const html = items.length
    ? (await getConsolidatedEmailHTML({ party, contactName, items })).split(`cid:${LOGO_CID}`).join('/company-logo.png')
    : '';

  return NextResponse.json({ to, subject: items.length ? getConsolidatedSubject(items, party, 'party') : '', html });
}
