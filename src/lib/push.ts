// src/lib/push.ts
// ============================================================
// Web Push for "someone wrote to you": the browser's push service wakes
// public/sw.js, which shows the notification — tab closed, browser in the
// background or phone locked. The in-tab alert (src/lib/notify.ts) only
// works while the app is open; this is what reaches everyone else.
//
// Devices register through POST /api/push (src/lib/pushClient.ts) into
// push_subscriptions (migration 083). Called after the row is saved by
// POST /api/notes, POST /api/jobs/[id]/comments and both message routes.
//
// Server-only: needs the service role and the VAPID private key.
// ============================================================

import webpush, { type PushSubscription } from 'web-push';
import { createAdminClient } from '@/lib/supabase/admin';

/** What a click on the notification opens — read by sw.js and the widgets. */
export type PushOpen = { kind: 'notes' } | { kind: 'messages'; conversationId: string };

export type PushPayload = {
  title: string;
  body:  string;
  /** The note/message id — same tag as the in-tab alert, so a device shows one, not two. */
  tag:   string;
  open:  PushOpen;
};

type Row = { endpoint: string; p256dh: string; auth: string };
type Send = (sub: PushSubscription, body: string) => Promise<unknown>;

// Push services cap a payload near 4 KB; a long note is cut for the pop-up.
const BODY_MAX = 240;

let ready: boolean | null = null;
function configure(): boolean {
  if (ready !== null) return ready;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  ready = Boolean(pub && priv);
  if (ready) webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:anshu.novelty@gmail.com', pub!, priv!);
  else console.warn('[push] VAPID keys not set — push notifications are off');
  return ready;
}

/** Sends to every row; returns the endpoints the push service says are gone
 *  (404/410: unsubscribed, browser data cleared) so they can be deleted.
 *  One device failing never stops the others. */
export async function deliver(rows: Row[], payload: PushPayload, send: Send): Promise<string[]> {
  const body = JSON.stringify({
    ...payload,
    body: payload.body.length > BODY_MAX ? `${payload.body.slice(0, BODY_MAX - 1)}…` : payload.body,
  });
  const gone: string[] = [];
  await Promise.all(rows.map((r) =>
    send({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, body).catch((e) => {
      const status = (e as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) gone.push(r.endpoint);
      else console.error('[push] send failed', status ?? e);
    }),
  ));
  return gone;
}

/**
 * Push to every device of `to` (emails, or 'everyone'), skipping `except`
 * — the sender. Never throws: the note or message is already saved, and a
 * failed push must not turn that into an error for the person who wrote it.
 *
 * ponytail: awaited inside the request (~a few hundred ms for a small team)
 * because Vercel can freeze the function once the response is sent; move
 * to waitUntil/after() if the team grows to where that delay is felt.
 */
export async function pushTo(to: string[] | 'everyone', except: string | null | undefined, payload: PushPayload) {
  try {
    if (!configure()) return;
    if (to !== 'everyone' && to.length === 0) return;

    const admin = createAdminClient();
    let q = admin.from('push_subscriptions').select('endpoint, p256dh, auth');
    if (to !== 'everyone') q = q.in('user_email', to);
    if (except) q = q.neq('user_email', except);
    const { data, error } = await q;
    if (error) throw error;

    const gone = await deliver(data ?? [], payload, (sub, body) =>
      webpush.sendNotification(sub, body, { TTL: 86_400, urgency: 'high', timeout: 5_000 }));
    if (gone.length) await admin.from('push_subscriptions').delete().in('endpoint', gone);
  } catch (e) {
    console.error('[push]', e);
  }
}
