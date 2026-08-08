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
// Each note can be marked read individually (POST /api/notes/read,
// see migration 017_note_reads) — read state is per user, synced across
// devices. A read note drops out of the panel, so what's left is always
// "what I still need to read." Replaces the old single localStorage
// "last seen" timestamp, which could only mark everything seen at once;
// that legacy marker is migrated into real read receipts on first load
// (see the backfill in `poll`) and then discarded.
//
// Refresh is polled, not Realtime — same call the room displays make,
// but at 25s rather than 2s: this runs in every open admin tab, so a
// tight interval would multiply across the whole team for no benefit.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { MessageSquare, X, BellRing, Check } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import toast from 'react-hot-toast';
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

/** Legacy pre-017 marker, kept only long enough to migrate it once. */
function lastSeenKey(email: string) {
  return `nl:notes:lastSeen:${email}`;
}

async function markNotesRead(ids: string[]) {
  const res = await fetch('/api/notes/read', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error('Failed to mark read');
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
  const [open,           setOpen]           = useState(false);
  const [notes,          setNotes]          = useState<NoteFeedItem[]>([]);
  const [unread,         setUnread]         = useState(0);
  const [filter,         setFilter]         = useState<'All' | Department>('All');
  const [error,          setError]          = useState(false);
  const [canPush,        setCanPush]        = useState<NotificationPermission | 'unsupported'>('unsupported');
  // Ids marked read locally but not yet confirmed by the next poll —
  // keeps a click feel instant instead of waiting on the 25s cycle.
  const [optimisticRead, setOptimisticRead] = useState<Set<string>>(new Set());

  // Refs, not state: the poll loop reads these without re-subscribing.
  const openRef = useRef(false);
  const panelRef = useRef<HTMLElement>(null);
  // Newest note id we have already fired a desktop notification for.
  // null until the first poll completes, so a page load never notifies
  // about the backlog. Doubles as the "is this the first poll" flag,
  // which gates the one-time legacy-marker migration below.
  const notifiedIdRef = useRef<string | null>(null);

  useEffect(() => { openRef.current = open; }, [open]);

  useEffect(() => {
    if ('Notification' in window) setCanPush(Notification.permission);
  }, []);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(FEED_URL, { cache: 'no-store' });
      if (!res.ok) { setError(true); return; }

      const data = await res.json() as { notes: NoteFeedItem[]; unread: number };
      setError(false);
      setNotes(data.notes);

      // Drop any optimistic ids the server has now confirmed as read.
      setOptimisticRead((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set(prev);
        for (const n of data.notes) if (n.read) next.delete(n.id);
        return next;
      });

      const newest = data.notes[0];
      const isFirstPoll = notifiedIdRef.current === null;

      // One-time backfill: fold the legacy "last seen" timestamp into real
      // read receipts so upgrading doesn't dump the whole note history
      // into everyone's unread pile. Only ever runs once per browser.
      let backfilledUnread = 0;
      if (isFirstPoll) {
        let legacy: string | null = null;
        try { legacy = window.localStorage.getItem(lastSeenKey(userEmail)); } catch { /* ignored */ }

        if (legacy) {
          const legacyMs = Date.parse(legacy);
          const toBackfill = Number.isFinite(legacyMs)
            ? data.notes.filter((n) => !n.read && Date.parse(n.created_at) <= legacyMs)
            : [];

          if (toBackfill.length > 0) {
            const ids = toBackfill.map((n) => n.id);
            markNotesRead(ids).catch(() => {
              // Best-effort backfill — a failure here just means those
              // notes still show as unread; the user can mark them read.
            });
            setOptimisticRead((prev) => new Set([...Array.from(prev), ...ids]));
            backfilledUnread = toBackfill.filter((n) => n.created_by_email !== userEmail).length;
          }
          try { window.localStorage.removeItem(lastSeenKey(userEmail)); } catch { /* ignored */ }
        }
      }

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

      setUnread(Math.max(0, data.unread - backfilledUnread));
    } catch {
      setError(true);
    }
  }, [userEmail]);

  const handleMarkRead = useCallback(async (note: NoteFeedItem) => {
    setOptimisticRead((prev) => new Set(prev).add(note.id));
    if (note.created_by_email !== userEmail) {
      setUnread((u) => Math.max(0, u - 1));
    }
    try {
      await markNotesRead([note.id]);
    } catch {
      toast.error('Could not mark as read — try again');
      setOptimisticRead((prev) => {
        const next = new Set(prev);
        next.delete(note.id);
        return next;
      });
      if (note.created_by_email !== userEmail) {
        setUnread((u) => u + 1);
      }
    }
  }, [userEmail]);

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

  // Close on a click/tap anywhere outside the panel — same transient-overlay
  // logic as Escape, just for the pointer. Registered only while open, so
  // the click that opens the panel (via the launcher button) can never
  // immediately close it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function handleOpen() {
    setOpen(true);
    poll(); // fetch fresh on open
  }

  async function requestPush() {
    if (!('Notification' in window)) return;
    const result = await Notification.requestPermission();
    setCanPush(result);
  }

  // Read notes drop out of the panel — what's left is what still needs
  // a look. History for a note stays on its job via StageComments.
  const unreadNotes = notes.filter((n) => !n.read && !optimisticRead.has(n.id));
  const visible = filter === 'All'
    ? unreadNotes
    : unreadNotes.filter((n) => n.created_by === filter);

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
      ref={panelRef}
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
        <div className="flex items-baseline gap-2 min-w-0">
          <h2 className="text-sm font-semibold">Internal Notes</h2>
          <span className="text-[11px] text-white/70">
            {unread > 0 ? `${unread} remaining to read` : 'All caught up'}
          </span>
        </div>
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
              : unreadNotes.length === 0
                ? 'All caught up — no unread notes.'
                : `No unread notes from ${filter}.`}
          </li>
        )}

        {visible.map((note) => (
          <li key={note.id} className="group relative">
            <Link
              href={`/admin/jobs/${note.job_id}`}
              onClick={() => setOpen(false)}
              className="block px-4 py-3 pr-14 hover:bg-brand-bg transition-colors focus:outline-none focus-visible:bg-brand-bg"
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

            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleMarkRead(note); }}
              aria-label="Mark as read"
              title="Mark as read"
              className={cn(
                'absolute right-1 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] rounded-full',
                'flex items-center justify-center text-brand-muted',
                'hover:text-white hover:bg-brand-primary transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40'
              )}
            >
              <Check className="h-4 w-4" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
