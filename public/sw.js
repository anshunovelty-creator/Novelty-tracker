// public/sw.js
// ============================================================
// Service worker: shows the push notifications src/lib/push.ts sends for
// new internal notes and messages — with the app closed, in a background
// tab or on a locked phone — and opens the right drawer when one is tapped.
// Registered by src/lib/pushClient.ts. Nothing is cached: this worker is
// for notifications only, the app stays online-first.
// ============================================================

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* not ours — show the fallback */ }

  event.waitUntil(self.registration.showNotification(data.title || 'Novelty Labels', {
    body:  data.body || 'You have a new message',
    // Same tag as the in-tab alert (src/lib/notify.ts), so a device that got
    // both shows the notification once.
    tag:   data.tag,
    icon:  '/icon.png',
    badge: '/icon.png',
    data:  { open: data.open || null },
  }));
});

/** Where the app should land for a tapped notification when no tab is open. */
function urlFor(open) {
  if (open && open.kind === 'messages') return `/admin?open=messages&c=${encodeURIComponent(open.conversationId)}`;
  if (open && open.kind === 'notes') return '/admin?open=notes';
  return '/admin';
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const open = event.notification.data && event.notification.data.open;

  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const tab = tabs.find((c) => new URL(c.url).pathname.startsWith('/admin'));
    if (tab) {
      await tab.focus();
      tab.postMessage({ type: 'push-open', open });
      return;
    }
    await self.clients.openWindow(urlFor(open));
  })());
});
