'use client';
// src/lib/pushClient.ts
// ============================================================
// The browser half of push notifications (server half: src/lib/push.ts).
//
// registerPush — registers public/sw.js and, once notifications are allowed,
//   subscribes this device and files it with POST /api/push. Run on every
//   admin load (NotificationPrompt) and right after permission is granted,
//   so devices that allowed notifications before push existed join too.
// listenForPushOpen — a tapped notification lands here (a message from
//   sw.js, or ?open= when it had to open a new tab) and opens the notes
//   drawer or the message thread through their window events.
// ============================================================

import { MESSAGES_OPEN_EVENT, NOTES_OPEN_EVENT } from '@/lib/constants/events';
import type { PushOpen } from '@/lib/push';

const VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array<ArrayBuffer>) =>
  !!a && a.byteLength === b.length && new Uint8Array(a).every((v, i) => v === b[i]);

export async function registerPush(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    if (!VAPID_KEY || !('PushManager' in window) || Notification.permission !== 'granted') return;
    await navigator.serviceWorker.ready;

    const key = keyBytes(VAPID_KEY);
    let sub = await reg.pushManager.getSubscription();
    // Subscribed under an older server key: those pushes would be rejected.
    if (sub && !sameKey(sub.options.applicationServerKey, key)) {
      await sub.unsubscribe();
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });

    await fetch('/api/push', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(sub),
    });
  } catch (e) {
    // No push on this device (e.g. iPhone Safari outside the Home Screen
    // app) — the in-tab alert still works while the app is open.
    console.warn('[push] not available on this device', e);
  }
}

function open(target: PushOpen | null | undefined) {
  if (target?.kind === 'notes') window.dispatchEvent(new Event(NOTES_OPEN_EVENT));
  if (target?.kind === 'messages') {
    window.dispatchEvent(new CustomEvent<string>(MESSAGES_OPEN_EVENT, { detail: target.conversationId }));
  }
}

export function listenForPushOpen(): () => void {
  // Launched by a tap with no tab open: sw.js put the target in the URL.
  // Taken out straight away so a reload doesn't reopen the drawer.
  const url = new URL(window.location.href);
  const kind = url.searchParams.get('open');
  if (kind === 'notes') open({ kind });
  if (kind === 'messages' && url.searchParams.get('c')) open({ kind, conversationId: url.searchParams.get('c')! });
  if (kind) {
    url.searchParams.delete('open');
    url.searchParams.delete('c');
    window.history.replaceState(window.history.state, '', url);
  }

  if (!('serviceWorker' in navigator)) return () => {};
  const onMessage = (e: MessageEvent) => { if (e.data?.type === 'push-open') open(e.data.open); };
  navigator.serviceWorker.addEventListener('message', onMessage);
  return () => navigator.serviceWorker.removeEventListener('message', onMessage);
}
