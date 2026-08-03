'use client';
// src/components/admin/NotesFeed.tsx
// ============================================================
// Global internal-note feed. Floating launcher bottom-right of the
// admin shell; opens a panel listing the newest notes across every job.
// Mounted by src/app/admin/layout.tsx; reads GET /api/notes/feed.
//
// Read-only by design: the only way to write a note stays StageComments,
// on the job it belongs to. That keeps every message traceable to a
// job + stage instead of drifting into untethered chat.
//
// Refresh is polled, not Realtime — same call the room displays make,
// but at 25s rather than 2s: this runs in every open admin tab, so a
// tight interval would multiply across the whole team for no benefit.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { MessageSquare, X, BellRing } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { cn } from '@/lib/utils';
import { DEPARTMENTS, type Department } from '@/lib/constants/departments';
import type { NoteFeedItem } from '@/lib/types';

const POLL_MS  = 25_000;
const FEED_URL = '/api/notes/feed?limit=50';

type Props = {
  /** Department of the signed-in user — only used to label "you" in the filter. */
  dept:      Department;
  userEmail: string;
};

function lastSeenKey(email: string) {
  return `nl:notes:lastSeen:${email}`;
}

/** The person if we have them, else the department alone (pre-016 notes). */
function attribution(note: NoteFeedItem): string {
  return note.created_by_email
    ? `${note.created_by_email} (${note.created_by})`
    : note.created_by;
}

function relativeTime(iso: string): string {
  try {
    return formatDistanceToNowStrict(new Date(iso), { addSuffix: true });
  } catch {
    return '';
  }
}

export default function NotesFeed({ dept, userEmail }: Props) {
  const [open,    setOpen]    = useState(false);
  const [notes,   setNotes]   = useState<NoteFeedItem[]>([]);
  const [unread,  setUnread]  = useState(0);
  const [filter,  setFilter]  = useState<'All' | Department>('All');
  const [error,   setError]   = useState(false);
  const [canPush, setCanPush] = useState<NotificationPermission | 'unsupported'>('unsupported');

  // Refs, not state: the poll loop reads these without re-subscribing.
  const lastSeenRef = useRef<string | null>(null);
  const openRef     = useRef(false);
  // Newest note id we have already fired a desktop notification for.
  // null until the first poll completes, so a page load never notifies
  // about the backlog.
  const notifiedIdRef = useRef<string | null>(null);

  useEffect(() => { openRef.current = open; }, [open]);

  // Restore the last-seen marker for this account.
  useEffect(() => {
    try {
      lastSeenRef.current = window.localStorage.getItem(lastSeenKey(userEmail));
    } catch {
      // Private mode / storage disabled — badge resets each load, feed still works.
    }
    if ('Notification' in window) setCanPush(Notification.permission);
  }, [userEmail]);

  const markSeen = useCallback((serverTime: string) => {
    lastSeenRef.current = serverTime;
    setUnread(0);
    try {
      window.localStorage.setItem(lastSeenKey(userEmail), serverTime);
    } catch {
      // Non-fatal; see above.
    }
  }, [userEmail]);

  const poll = useCallback(async () => {
    const since = lastSeenRef.current;
    const url   = since ? `${FEED_URL}&since=${encodeURIComponent(since)}` : FEED_URL;

    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) { setError(true); return; }

      const data = await res.json() as {
        notes: NoteFeedItem[]; unread: number; serverTime: string;
      };
      setError(false);
      setNotes(data.notes);

      const newest = data.notes[0];
      const isFirstPoll = notifiedIdRef.current === null;

      // Desktop notification: only for someone else's note, only when the
      // panel is shut, and never for the backlog present at page load.
      if (
        newest &&
        !isFirstPoll &&
        newest.id !== notifiedIdRef.current &&
        newest.created_by_email !== userEmail &&
        !openRef.current &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        const job = newest.job_name || newest.po_number;
        new Notification(`${newest.created_by} — ${job}`, {
          body: newest.comment,
          tag:  newest.id, // collapses duplicates if several tabs are open
        });
      }
      if (newest) notifiedIdRef.current = newest.id;

      // An open panel is "being read": keep advancing the marker so the
      // badge does not build up behind the user's back.
      if (openRef.current) markSeen(data.serverTime);
      else setUnread(data.unread);
    } catch {
      setError(true);
    }
  }, [markSeen, userEmail]);

  // Poll while the tab is visible; catch up immediately on refocus.
  useEffect(() => {
    poll();
    let timer = window.setInterval(poll, POLL_MS);

    const onVisibility = () => {
      window.clearInterval(timer);
      if (document.visibilityState === 'visible') {
        poll();
        timer = window.setInterval(poll, POLL_MS);
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [poll]);

  // Close on Escape — the panel is a transient overlay, not a route.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  function handleOpen() {
    setOpen(true);
    setUnread(0);
    poll(); // fetch fresh on open; also advances the marker via openRef
  }

  async function requestPush() {
    if (!('Notification' in window)) return;
    const result = await Notification.requestPermission();
    setCanPush(result);
  }

  const visible = filter === 'All'
    ? notes
    : notes.filter((n) => n.created_by === filter);

  // ── Launcher ────────────────────────────────────────────────
  if (!open) {
    return (
      <button
        onClick={handleOpen}
        aria-label={unread > 0 ? `Internal notes, ${unread} unread` : 'Internal notes'}
        className={cn(
          'fixed bottom-5 right-5 z-50 h-14 w-14 rounded-full',
          'bg-brand-primary hover:bg-brand-primary-hover text-white',
          'shadow-lg shadow-black/20 flex items-center justify-center',
          'transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-primary/40'
        )}
      >
        <MessageSquare className="h-6 w-6" aria-hidden="true" />
        {unread > 0 && (
          <span
            className={cn(
              'absolute -top-1 -right-1 min-w-[22px] h-[22px] px-1 rounded-full',
              'bg-brand-danger text-white text-[11px] font-semibold leading-[22px]',
              'ring-2 ring-white'
            )}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
    );
  }

  // ── Panel ───────────────────────────────────────────────────
  return (
    <section
      aria-label="Internal notes"
      className={cn(
        'fixed bottom-5 right-5 z-50 flex flex-col',
        'w-[min(92vw,400px)] max-h-[min(70vh,560px)]',
        'bg-brand-surface border border-brand-border rounded-2xl',
        'shadow-2xl shadow-black/20 overflow-hidden'
      )}
    >
      {/* Header */}
      <header className="flex items-center justify-between gap-2 px-4 h-12 bg-brand-header text-white shrink-0">
        <h2 className="text-sm font-semibold">Internal Notes</h2>
        <div className="flex items-center gap-1">
          {canPush === 'default' && (
            <button
              onClick={requestPush}
              title="Get a desktop alert for new notes"
              className="p-2 rounded-lg text-white/75 hover:text-white hover:bg-white/10 transition-colors"
            >
              <BellRing className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Enable desktop alerts</span>
            </button>
          )}
          <button
            onClick={() => setOpen(false)}
            aria-label="Close internal notes"
            className="p-2 rounded-lg text-white/75 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Department filter — every note from every job lands here, so a
          busy day is a lot of scrolling without it. */}
      <div className="px-4 py-2 border-b border-brand-border shrink-0">
        <label className="sr-only" htmlFor="notes-dept-filter">Filter by department</label>
        <select
          id="notes-dept-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value as 'All' | Department)}
          className="w-full text-xs rounded-lg border border-brand-border bg-brand-bg px-2 py-1.5 text-brand-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
        >
          <option value="All">All departments</option>
          {DEPARTMENTS.map((d) => (
            <option key={d} value={d}>{d}{d === dept ? ' (you)' : ''}</option>
          ))}
        </select>
      </div>

      {/* Feed */}
      <ul className="flex-1 overflow-y-auto divide-y divide-brand-border">
        {error && notes.length === 0 && (
          <li className="px-4 py-6 text-center text-xs text-brand-danger">
            Could not load notes. Retrying…
          </li>
        )}

        {!error && visible.length === 0 && (
          <li className="px-4 py-8 text-center text-xs text-brand-muted">
            {notes.length === 0
              ? 'No internal notes yet. Notes added on any job appear here.'
              : `No notes from ${filter}.`}
          </li>
        )}

        {visible.map((note) => (
          <li key={note.id}>
            <Link
              href={`/admin/jobs/${note.job_id}`}
              onClick={() => setOpen(false)}
              className="block px-4 py-3 hover:bg-brand-bg transition-colors focus:outline-none focus-visible:bg-brand-bg"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] font-mono text-brand-primary truncate">
                  {attribution(note)}
                </span>
                <time
                  dateTime={note.created_at}
                  className="text-[10px] text-brand-muted shrink-0"
                >
                  {relativeTime(note.created_at)}
                </time>
              </div>

              <p className="mt-1 text-xs text-brand-ink break-words">
                {note.comment}
              </p>

              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-brand-muted">
                <span className="font-medium text-brand-ink/70 truncate max-w-[55%]">
                  {note.job_name || note.po_number}
                </span>
                {note.pm_code && <span className="font-mono">{note.pm_code}</span>}
                <span className="px-1.5 py-0.5 rounded bg-brand-bg border border-brand-border">
                  {note.stage}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
