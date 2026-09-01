// src/app/api/dispatch-notifications/send/route.ts
// POST /api/dispatch-notifications/send { party, target, itemIds? } — sends
// ONE consolidated dispatch email to EITHER the party's client contact OR
// the internal team (independent actions — the team sends internal first,
// then the party's copy some time later). Only the party send clears rows
// from the pending list; the internal send just stamps internal_notified_at
// for bookkeeping.
//
// itemIds lets the internal-team send target a single row (or a subset)
// instead of every pending item for the party — packing/prep can finish at
// different times per item even though they all ship together, so the team
// may need to hear about one item before the rest are ready. When itemIds
// is omitted, the internal send only picks up items not yet internally
// notified (so it doesn't duplicate a row already sent individually); the
// party send always covers every pending item, since the party gets exactly
// one email per truck regardless of how the team was notified.
// Dispatch/Admin only.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptManageDispatchNotifications } from '@/lib/constants/departments';
import { getConsolidatedSubject, getConsolidatedEmailHTML, getDispatchThreadKey, type DispatchItem } from '@/lib/notifications/dispatchEmailTemplate';
import { isMailerConfigured, sendMail } from '@/lib/notifications/mailer';
import type { PendingDispatchNotification } from '@/lib/types';

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!canDeptManageDispatchNotifications(perms)) {
    return NextResponse.json({ error: 'Only Dispatch/Admin can send dispatch notifications' }, { status: 403 });
  }

  const body    = await request.json();
  const party   = typeof body.party === 'string' ? body.party.trim() : '';
  const target  = body.target === 'internal' || body.target === 'party' ? body.target : null;
  const itemIds = Array.isArray(body.itemIds)
    ? body.itemIds.filter((id: unknown): id is string => typeof id === 'string')
    : null;
  if (!party)  return NextResponse.json({ error: 'party is required' }, { status: 400 });
  if (!target) return NextResponse.json({ error: "target must be 'internal' or 'party'" }, { status: 400 });

  const admin = createAdminClient();
  let query = admin
    .from('pending_dispatch_notifications')
    .select('*')
    .eq('party', party)
    .is('notified_at', null);

  if (itemIds && itemIds.length > 0) {
    query = query.in('id', itemIds);
  } else if (target === 'internal') {
    // Bulk internal send: skip rows already sent individually so a later
    // "one go" send doesn't duplicate a row someone already notified about.
    query = query.is('internal_notified_at', null);
  }

  const { data: pending, error: pendingError } = await query.order('created_at', { ascending: true });

  if (pendingError) return NextResponse.json({ error: pendingError.message }, { status: 500 });

  const items = (pending ?? []) as PendingDispatchNotification[];
  if (items.length === 0) {
    return NextResponse.json({ skipped: true, reason: 'no_pending' });
  }

  let sentToParty    = false;
  let sentToInternal = false;

  if (isMailerConfigured()) {
    const dispatchItems: DispatchItem[] = items.map((i) => ({
      job_name:  i.job_name,
      po_number: i.po_number,
      status:    i.status,
      qty:       i.qty,
      remark:    i.remark,
      pm_code:   i.pm_code,
    }));

    if (target === 'party') {
      // A party can have several contacts on file (migration 046) — every
      // one of them gets this email. The individual-name greeting only
      // makes sense when there's exactly one; otherwise it falls back to
      // the party/company name (see getConsolidatedEmailHTML).
      const { data: contacts } = await admin
        .from('party_contacts')
        .select('email, contact_name')
        .eq('party', party);

      const partyEmails = (contacts ?? [])
        .map((c) => c.email)
        .filter((email): email is string => Boolean(email));

      if (partyEmails.length > 0) {
        const contactName = contacts?.length === 1 ? contacts[0].contact_name : null;
        const html = getConsolidatedEmailHTML({ party, contactName, items: dispatchItems });
        try {
          // Subject carries the PO so repeat dispatches to one party no
          // longer share an identical subject (which had Gmail collapsing
          // unrelated dispatches into a single conversation); threadKey
          // then groups the ones that genuinely belong together — see
          // dispatchEmailTemplate. The party copy threads across dates on
          // purpose, so the client sees the full PO history in one place.
          const subject   = getConsolidatedSubject(dispatchItems, party, 'party');
          const threadKey = getDispatchThreadKey(dispatchItems, party, 'party');
          await sendMail({ to: partyEmails, subject, html, threadKey, inlineLogo: true });
          sentToParty = true;
        } catch (err) {
          console.error('[dispatch-notifications send] client email:', err);
        }
      }
    } else {
      // Internal team — addressed "Dear Team" instead of the party's
      // contact so it reads as an internal record, not a copy of the
      // client's own letter.
      const { data: recipients } = await admin
        .from('internal_notification_recipients')
        .select('email');
      const internalEmails = (recipients ?? []).map((r) => r.email);

      if (internalEmails.length > 0) {
        const html = getConsolidatedEmailHTML({ party, items: dispatchItems, audience: 'team' });
        try {
          // Team copy is date-stamped and threads per-day — a dispatch of
          // the same PO on a later date must not collapse into the earlier
          // day's team email (see dispatchEmailTemplate).
          const subject   = getConsolidatedSubject(dispatchItems, party, 'team');
          const threadKey = getDispatchThreadKey(dispatchItems, party, 'team');
          await sendMail({ to: internalEmails, subject, html, threadKey, inlineLogo: true });
          sentToInternal = true;
        } catch (err) {
          console.error('[dispatch-notifications send] internal email:', err);
        }
      }
    }
  }

  // Party send clears the rows from the pending queue (and, via the DB
  // trigger, prunes sent history beyond the last 100). Internal send just
  // stamps internal_notified_at — the rows stay pending for the party send.
  const { error: markError } = await admin
    .from('pending_dispatch_notifications')
    .update(
      target === 'party'
        ? { notified_at: new Date().toISOString() }
        : { internal_notified_at: new Date().toISOString() },
    )
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
