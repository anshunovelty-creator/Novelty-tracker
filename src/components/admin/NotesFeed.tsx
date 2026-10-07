'use client';
// src/components/admin/NotesFeed.tsx
// ============================================================
// Internal notes drawer. Opens from the right under the header — from the
// header's Notes button or the phone tab bar's (NOTES_OPEN_EVENT) — and lists
// the newest notes across every job, grouped by day, with All / Unread /
// Mentions me. Mounted by src/app/admin/layout.tsx; reads GET /api/notes/feed.
//
// Every note still belongs to a job and a stage: the composer at the bottom
// writes to one job (POST /api/jobs/[id]/comments), filed at that job's
// current stage, so nothing drifts into untethered chat. Reply picks the
// note's job and tags its department (@QC); "Mentions me" finds notes that
// tag yours.
//
// Read state is per user, synced across devices (POST /api/notes/read, see
// migration 017_note_reads). The old single localStorage "last seen"
// timestamp is migrated into real read receipts on first load (see the
// backfill in `poll`) and then discarded.
//
// Realtime delivers new notes as they're written; the slow poll is only the
// safety net for a dropped socket.
// ============================================================

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { X, Send } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { requestOpen, subscribeActiveWidget } from '@/lib/floatingWidgetCoordinator';
import { NOTES_OPEN_EVENT, NOTES_UNREAD_EVENT } from '@/lib/constants/events';
import { filterNotes, groupByDay, mentions, type NotesTab } from '@/lib/notesView';
import { useTeamDirectory } from '@/hooks/useReferenceData';
import { MentionText, MentionTextarea } from '@/components/ui/Mention';
import { initials } from '@/lib/team';
import { notify } from '@/lib/notify';
import { DesktopNotificationsToggle } from '@/components/ui/DesktopNotificationsToggle';
import type { NoteFeedItem } from '@/lib/types';

const POLL_MS  = 60_000;
const FEED_URL = '/api/notes/feed?limit=50';

type Props = {
  /** Department of the signed-in user, as people write it: "QC". Used for "Mentions me". */
  deptName:  string;
  deptKey:   string;
  userEmail: string;
  /** The signed-in user's @username — a note tagging it counts as a mention. */
  username:  string;
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

// Department avatar colours — a fixed few, picked by name so a department
// keeps its colour everywhere.
const AVATAR = ['#0e7490', '#7e22ce', '#4338ca', '#047857', '#b45309', '#be185d'];
function avatarColour(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR[h % AVATAR.length];
}

const TABS: { id: NotesTab; label: string }[] = [
  { id: 'all',      label: 'All' },
  { id: 'unread',   label: 'Unread' },
  { id: 'mentions', label: 'Mentions me' },
];

export default function NotesFeed({ deptName, deptKey, userEmail, username }: Props) {
  const [open,           setOpen]           = useState(false);
  const [notes,          setNotes]          = useState<NoteFeedItem[]>([]);
  const [unread,         setUnread]         = useState(0);
  const [tab,            setTab]            = useState<NotesTab>('unread');
  const [error,          setError]          = useState(false);
  // Ids marked read locally but not yet confirmed by the next poll.
  const [optimisticRead, setOptimisticRead] = useState<Set<string>>(new Set());
  // Composer
  const [jobId,   setJobId]   = useState('');
  const [draft,   setDraft]   = useState('');
  const [posting, setPosting] = useState(false);
  const draftRef = useRef<HTMLTextAreaElement | null>(null);
  const titleId  = useId();

  // Authors are stored by email; the directory turns that into a username.
  const { nameOf } = useTeamDirectory();

  // Refs, not state: the poll loop reads these without re-subscribing.
  const openRef = useRef(false);
  const nameOfRef = useRef(nameOf);
  const myNamesRef = useRef<string[]>([deptName, deptKey, username]);
  useEffect(() => {
    nameOfRef.current = nameOf;
    myNamesRef.current = [deptName, deptKey, username];
  });
  // Newest note id we have already fired a desktop notification for.
  // null until the first poll completes, so a page load never notifies
  // about the backlog. Doubles as the "is this the first poll" flag,
  // which gates the one-time legacy-marker migration below.
  const notifiedIdRef = useRef<string | null>(null);

  useEffect(() => { openRef.current = open; }, [open]);

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

      // Chime + pop-up (src/lib/notify): only for someone else's note, not
      // while the drawer is open in front of you, and never for the backlog
      // present at page load.
      if (
        newest &&
        !isFirstPoll &&
        newest.id !== notifiedIdRef.current &&
        newest.created_by_email !== userEmail &&
        !(openRef.current && document.visibilityState === 'visible')
      ) {
        const job = newest.job_name || newest.po_number;
        const who = nameOfRef.current(newest.created_by_email) || newest.created_by;
        const forMe = mentions(newest.comment, myNamesRef.current);
        notify({
          id:     newest.id,
          title:  forMe ? `${who} mentioned you — ${job}` : `${who} — ${job}`,
          body:   newest.comment,
          onOpen: () => window.dispatchEvent(new Event(NOTES_OPEN_EVENT)),
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

  // Poll while the tab is visible; catch up immediately on refocus. A tab
  // opened in the background (middle-click, restored session) loads once and
  // waits — the timer only starts when someone actually looks at it.
  useEffect(() => {
    poll();
    const visible = () => document.visibilityState === 'visible';
    let timer = visible() ? window.setInterval(poll, POLL_MS) : undefined;

    const onVisibility = () => {
      window.clearInterval(timer);
      timer = undefined;
      if (visible()) {
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

  // Realtime nudge: a new stage comment anywhere re-runs the same poll, so
  // unread counts and the read-state join stay computed server-side.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('stage_comments_changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'stage_comments' }, () => {
        poll();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [poll]);

  // Close on Escape — the drawer is a transient overlay, not a route.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Close whenever another floating widget (To-Do, Meter Calculator, Messages)
  // opens — see floatingWidgetCoordinator.ts.
  useEffect(() => {
    if (!open) return;
    return subscribeActiveWidget((activeId) => {
      if (activeId !== 'notes') setOpen(false);
    });
  }, [open]);

  function handleOpen() {
    requestOpen('notes');
    setOpen(true);
    poll(); // fetch fresh on open
  }

  // The header's Notes button lives in another subtree; it asks by event,
  // and reads the unread count the same way rather than polling twice.
  const handleOpenRef = useRef(handleOpen);
  useEffect(() => { handleOpenRef.current = handleOpen; });
  useEffect(() => {
    const onOpen = () => handleOpenRef.current();
    window.addEventListener(NOTES_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(NOTES_OPEN_EVENT, onOpen);
  }, []);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent<number>(NOTES_UNREAD_EVENT, { detail: unread }));
  }, [unread]);

  const isRead  = useCallback((n: NoteFeedItem) => n.read || optimisticRead.has(n.id), [optimisticRead]);
  // A note tags me when it names my username or my department.
  const myNames = useMemo(() => [deptName, deptKey, username], [deptName, deptKey, username]);
  const visible = useMemo(
    () => filterNotes(notes, tab, { isRead, me: userEmail, myNames }),
    [notes, tab, isRead, userEmail, myNames],
  );
  const mentionCount = useMemo(
    () => filterNotes(notes, 'mentions', { isRead, me: userEmail, myNames }).filter((n) => !isRead(n)).length,
    [notes, isRead, userEmail, myNames],
  );

  // Jobs the composer can write to: the ones in the feed, newest first.
  const jobs = useMemo(() => {
    const seen = new Map<string, NoteFeedItem>();
    for (const n of notes) if (!seen.has(n.job_id)) seen.set(n.job_id, n);
    return Array.from(seen.values());
  }, [notes]);
  const composeJob = jobs.find((j) => j.job_id === jobId) ?? jobs[0] ?? null;

  function reply(note: NoteFeedItem) {
    setJobId(note.job_id);
    const tag = `@${nameOf(note.created_by_email) || note.created_by} `;
    setDraft((d) => (d.startsWith(tag) ? d : tag + d));
    requestAnimationFrame(() => {
      const el = draftRef.current;
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    });
  }

  async function post(e: React.FormEvent | React.KeyboardEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !composeJob || posting) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/jobs/${composeJob.job_id}/comments`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ stage: composeJob.job_status ?? composeJob.stage, comment: text }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(body.error ?? 'Could not post the note'); return; }
      setDraft('');
      setTab('all');
      poll();
    } catch {
      toast.error('Network error. Try again.');
    } finally {
      setPosting(false);
    }
  }

  // ── Launcher ────────────────────────────────────────────────
  // None of its own: the header's Notes button (and the phone tab bar's)
  // opens the drawer through NOTES_OPEN_EVENT and carries the badge.
  if (!open) return null;

  const groups = groupByDay(visible);

  return (
    <>
      {/* Scrim under the header — a click on it closes the drawer. */}
      <div aria-hidden="true" onClick={() => setOpen(false)} className="fixed inset-x-0 bottom-0 top-14 z-40 bg-[rgba(10,31,24,0.22)]" />

      <aside
        role="dialog"
        aria-labelledby={titleId}
        className="nav-panel-in fixed bottom-0 right-0 top-14 z-50 flex w-full flex-col bg-white shadow-[-18px_0_50px_rgba(12,42,32,0.18)] sm:w-[460px]"
      >
        <div className="flex items-center justify-between gap-3 px-6 pb-3 pt-5">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 id={titleId} className="text-xl font-semibold text-brand-ink">Internal notes</h2>
            <span className="text-[13px] text-brand-muted">
              From every job and stage · <span className="font-mono">{unread}</span> unread
            </span>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close notes"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-[#F1F5F2] text-brand-ink hover:bg-brand-surface-hover"
          >
            <X className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-col gap-2.5 border-b border-brand-line-soft px-6 pb-3">
          <div role="radiogroup" aria-label="Show" className="flex gap-0.5 rounded-[10px] bg-brand-sunken p-[3px]">
            {TABS.map((t) => {
              const on = tab === t.id;
              const n = t.id === 'unread' ? unread : t.id === 'mentions' ? mentionCount : 0;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'h-9 flex-1 rounded-lg text-[13px] transition-colors',
                    on ? 'bg-white font-semibold text-brand-ink shadow-[0_1px_3px_rgba(12,42,32,0.12)]' : 'font-medium text-brand-muted hover:text-brand-ink',
                  )}
                >
                  {t.label}{n > 0 && <> · <span className="font-mono">{n}</span></>}
                </button>
              );
            })}
          </div>
          <DesktopNotificationsToggle />
        </div>

        {/* Feed */}
        <div className="flex-1 overflow-y-auto">
          {error && notes.length === 0 && (
            <p className="px-6 py-8 text-center text-sm text-brand-danger">Could not load notes. Retrying…</p>
          )}
          {!error && visible.length === 0 && (
            <p className="px-6 py-10 text-center text-sm text-brand-muted">
              {notes.length === 0
                ? 'No internal notes yet. Notes written on any job appear here.'
                : tab === 'unread'
                  ? 'All caught up — no unread notes.'
                  : tab === 'mentions'
                    ? `No notes tag @${username} or @${deptKey} yet.`
                    : 'No notes.'}
            </p>
          )}

          {groups.map((g) => (
            <section key={g.label} aria-label={g.label}>
              <h3 className="px-6 pb-1.5 pt-4 text-[11px] font-semibold uppercase tracking-[0.06em] text-brand-muted">{g.label}</h3>
              <ul>
                {g.notes.map((note) => {
                  const read = isRead(note);
                  const mine = note.created_by_email === userEmail;
                  const who  = nameOf(note.created_by_email) || note.created_by;
                  return (
                    <li key={note.id} className="relative flex gap-3 px-6 py-3.5 hover:bg-[#F8FBF9]">
                      {!read && !mine && (
                        <span aria-label="Unread" className="absolute left-2.5 top-6 h-1.5 w-1.5 rounded-full bg-brand-primary" />
                      )}
                      <span
                        aria-hidden="true"
                        className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] font-mono text-[11px] font-semibold text-white"
                        style={{ background: avatarColour(who) }}
                      >
                        {initials(who)}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-brand-muted">
                          <strong className="text-[13px] text-brand-ink" title={note.created_by_email ?? undefined}>{who}</strong>
                          <Link
                            href={`/admin/jobs/${note.job_id}`}
                            onClick={() => setOpen(false)}
                            className="inline-flex items-center rounded-lg border border-brand-border bg-[#F1F5F2] px-2 py-0.5 font-mono text-xs font-semibold text-brand-ink hover:border-brand-primary"
                          >
                            {note.po_number}
                          </Link>
                          <span>at {note.stage}</span>
                          <time dateTime={note.created_at} className="ml-auto font-mono">{format(new Date(note.created_at), 'HH:mm')}</time>
                        </div>
                        <p className={cn('break-words text-sm leading-normal', read || mine ? 'text-brand-muted' : 'text-brand-ink')}>
                          <MentionText text={note.comment} />
                        </p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => reply(note)}
                            className="min-h-8 rounded-lg border border-brand-border bg-white px-2.5 text-xs font-medium text-brand-ink hover:bg-brand-surface-hover"
                          >
                            Reply
                          </button>
                          {!read && !mine && (
                            <button
                              type="button"
                              onClick={() => handleMarkRead(note)}
                              className="min-h-8 rounded-lg px-2.5 text-xs font-medium text-brand-muted hover:bg-brand-surface-hover hover:text-brand-ink"
                            >
                              Mark read
                            </button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        {/* Composer — always on a job, filed at the job's current stage. */}
        {composeJob && (
          <form onSubmit={post} className="flex flex-col gap-2.5 border-t border-brand-line-soft bg-[#F8FBF9] px-4 pb-4 pt-3.5">
            <label className="flex items-center gap-2 text-xs text-brand-muted">
              On job
              <select
                value={composeJob.job_id}
                onChange={(e) => setJobId(e.target.value)}
                className="min-h-8 max-w-[60%] rounded-lg border border-brand-border bg-white px-2 font-mono text-xs font-semibold text-brand-ink"
              >
                {jobs.map((j) => (
                  <option key={j.job_id} value={j.job_id}>{j.po_number} · {j.party}</option>
                ))}
              </select>
              <span className="truncate">at {composeJob.job_status ?? composeJob.stage}</span>
            </label>
            <div className="flex items-end gap-2">
              <label className="flex-1">
                <span className="sr-only">Write a note</span>
                <MentionTextarea
                  inputRef={draftRef}
                  rows={2}
                  value={draft}
                  onValueChange={setDraft}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post(e); }}
                  placeholder="Write a note… type @ to tag a person or department"
                  className="resize-none rounded-xl border border-brand-border bg-white px-3 py-2.5 text-sm leading-normal text-brand-ink focus:border-brand-primary focus:outline-none"
                />
              </label>
              <button
                type="submit"
                disabled={posting || !draft.trim()}
                aria-label="Post note"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-primary text-white hover:bg-brand-primary-hover disabled:opacity-40"
              >
                <Send className="h-[18px] w-[18px]" aria-hidden="true" />
              </button>
            </div>
          </form>
        )}
      </aside>
    </>
  );
}
