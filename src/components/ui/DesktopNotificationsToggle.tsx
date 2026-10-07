'use client';
// src/components/ui/DesktopNotificationsToggle.tsx
// "Desktop notifications" switch shown in the Notes and Messages drawers,
// and NotificationPrompt, the one-time card that asks on first visit.
// The browser only asks for permission from a click, so this is where it's
// asked. Once allowed (or blocked) the browser owns the setting, not us.

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export function DesktopNotificationsToggle({ className }: { className?: string }) {
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>('unsupported');

  useEffect(() => {
    if ('Notification' in window) setPerm(Notification.permission);
  }, []);

  if (perm === 'unsupported') return null;

  return (
    <label className={cn('flex min-h-9 items-center justify-between gap-3 text-[13px] text-brand-muted', className)}>
      Desktop notifications
      {perm === 'denied' ? (
        <span className="text-xs">Blocked in this browser’s settings</span>
      ) : (
        <input
          type="checkbox"
          checked={perm === 'granted'}
          disabled={perm === 'granted'}
          onChange={async () => setPerm(await Notification.requestPermission())}
          className="h-5 w-5 accent-brand-primary"
        />
      )}
    </label>
  );
}

const PROMPT_DISMISSED = 'nl:notif-prompt-dismissed';

/** Card under the header asking to turn notifications on, until the browser
 *  has an answer (allowed or blocked) or the user says "Not now" — the
 *  drawer switches above stay as the way back in. Mounted in the admin layout. */
export function NotificationPrompt() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!('Notification' in window) || Notification.permission !== 'default') return;
    try { if (window.localStorage.getItem(PROMPT_DISMISSED)) return; } catch { /* show it */ }
    setShow(true);
  }, []);

  if (!show) return null;

  function notNow() {
    try { window.localStorage.setItem(PROMPT_DISMISSED, '1'); } catch { /* ignored */ }
    setShow(false);
  }

  return (
    <div
      role="region"
      aria-label="Turn on notifications"
      className="fixed inset-x-4 top-[68px] z-40 flex flex-col gap-3 rounded-xl border border-brand-border bg-white p-4 shadow-[0_12px_32px_rgba(12,42,32,0.16)] sm:left-auto sm:right-5 sm:w-[360px]"
    >
      <div className="flex flex-col gap-1">
        <strong className="text-sm text-brand-ink">Turn on notifications</strong>
        <span className="text-[13px] text-brand-muted">
          Get a pop-up and a sound when someone messages you or adds an internal note.
        </span>
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={notNow}
          className="min-h-11 rounded-xl px-3 text-sm font-medium text-brand-muted hover:bg-brand-surface-hover hover:text-brand-ink"
        >
          Not now
        </button>
        <button
          type="button"
          onClick={async () => { await Notification.requestPermission(); setShow(false); }}
          className="min-h-11 rounded-xl bg-brand-primary px-4 text-sm font-semibold text-white hover:bg-brand-primary-hover"
        >
          Turn on
        </button>
      </div>
    </div>
  );
}
