// src/app/api/dispatch-notifications/send/route.ts
// POST /api/dispatch-notifications/send { party } — sends ONE consolidated
// dispatch email covering every pending item for that party (to the party's
// client contact, and a copy to the internal team), then marks those rows
// notified. Dispatch/Admin only.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseDepartment, canDeptManageDispatchNotifications } from '@/lib/constants/departments';
import { getConsolidatedSubject, getConsolidatedEmailHTML, type DispatchItem } from '@/lib/notifications/dispatchEmailTemplate';
import { isMailerConfigured, sendMail } from '@/lib/notifications/mailer';
import type { PendingDispatchNotification } from '@/lib/types';

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dept = parseDepartment(user.user_metadata?.department);
  if (!canDeptManageDispatchNotifications(dept)) {
    return NextResponse.json({ error: 'Only Dispatch/Admin can send dispatch notifications' }, { status: 403 });
  }

  const body = await request.json();
  const party = typeof body.party === 'string' ? body.party.trim() : '';
  if (!party) {
    return NextResponse.json({ error: 'party is required' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: pending, error: pendingError } = await admin
    .from('pending_dispatch_notifications')
    .select('*')
    .eq('party', party)
    .is('notified_at', null)
    .order('created_at', { ascending: true });

  if (pendingError) return NextResponse.json({ error: pendingError.message }, { status: 500 });

  const items = (pending ?? []) as PendingDispatchNotification[];
  if (items.length === 0) {
    return NextResponse.json({ skipped: true, reason: 'no_pending' });
  }

  let sentToParty    = false;
  let sentToInternal = false;

  if (isMailerConfigured()) {
    const subject     = getConsolidatedSubject(items.length, party);
    const dispatchItems: DispatchItem[] = items.map((i) => ({
      job_name:  i.job_name,
      po_number: i.po_number,
      status:    i.status,
      qty:       i.qty,
    }));
    const html = getConsolidatedEmailHTML({ party, items: dispatchItems });

    // Client — same "no contact on file" skip behavior as the single-job route.
    const { data: contact } = await admin
      .from('party_contacts')
      .select('email')
      .eq('party', party)
      .maybeSingle();

    if (contact?.email) {
      try {
        await sendMail({ to: contact.email, subject, html });
        sentToParty = true;
      } catch (err) {
        console.error('[dispatch-notifications send] client email:', err);
      }
    }

    // Internal team.
    const { data: recipients } = await admin
      .from('internal_notification_recipients')
      .select('email');
    const internalEmails = (recipients ?? []).map((r) => r.email);

    if (internalEmails.length > 0) {
      try {
        await sendMail({ to: internalEmails, subject, html });
        sentToInternal = true;
      } catch (err) {
        console.error('[dispatch-notifications send] internal email:', err);
      }
    }
  }

  const { error: markError } = await admin
    .from('pending_dispatch_notifications')
    .update({ notified_at: new Date().toISOString() })
    .in('id', items.map((i) => i.id));

  if (markError) {
    console.error('[dispatch-notifications send] mark notified:', markError);
  }

  return NextResponse.json({
    sent:            true,
    item_count:      items.length,
    sent_to_party:    sentToParty,
    sent_to_internal: sentToInternal,
  });
}
