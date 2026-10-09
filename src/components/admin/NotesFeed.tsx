'use client';
// src/components/admin/NotesFeed.tsx
// ============================================================
// Internal notes drawer. Opens from the right under the header — from the
// header's Notes button or the phone tab bar's (NOTES_OPEN_EVENT) — and lists
// the newest notes across every job, grouped by day, with All / Unread /
// Mentions me. Mounted by src/app/admin/layout.tsx; reads GET /api/notes/feed.
//
// The composer defaults to no job: a general note for the team
// (POST /api/notes, migration 077). Searching attaches a job instead, and the
// note is filed on it at the job's current stage (POST /api/jobs/[id]/comments).
// Chat order, WhatsApp-style: oldest at the top, newest at the bottom, and
// the list stays pinned to the bottom unless you've scrolled up to read.
// Reply quotes the note (reply_to_id, migration 078) and picks its job (or
// none); tapping a quote jumps to the original. "Mentions me" finds notes
// that tag you or your department, and replies to your notes.
//
// Read state is per user, synced across devices (POST /api/notes/read, see
// migration 017_note_reads). The old single localStorage "last seen"
// timestamp is migrated into real read receipts on first load (see the
// backfill in `poll`) and then discarded.
//
// Realtime delivers new notes as they're written; the slow poll is only the
// safety net for a dropped socket.
// ============================================================

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { X, Send, Reply, Trash2 } from 'lucide-react';
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

/** A job the composer can file a note on — a /api/search job row. */
type PickedJob = { id: string; po_number: string; party: string; job_name: string | null; status: string };

type Props = {
  /** Department of the signed-in user, as people write it: "QC". Used for "Mentions me". */
  deptName:  string;
  deptKey:   string;
  userEmail: string;
  /** The signed-in user's @username — a note tagging it counts as a mention. */
  username:  string;
  /** Admin can delete any note for everyone (DELETE /api/notes/[id]). */
  isAdmin:   boolean;
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

export default function NotesFeed({ deptName, deptKey, userEmail, username, isAdmin }: Props) {
  const [open,           setOpen]           = useState(false);
  const [notes,          setNotes]          = useState<NoteFeedItem[]>([]);
  const [unread,         setUnread]         = useState(0);
  const [tab,            setTab]            = useState<NotesTab>('unread');
  const [error,          setError]          = useState(false);
  // Ids marked read locally but not yet confirmed by the next poll.
  const [optimisticRead, setOptimisticRead] = useState<Set<string>>(new Set());
  // Composer
  const [job,     setJob]     = useState<PickedJob | null>(null);
  const [jobQuery, setJobQuery] = useState('');
  const [jobHits,  setJobHits]  = useState<PickedJob[]>([]);
  const [jobActive, setJobActive] = useState(0);
  const [draft,   setDraft]   = useState('');
  const [replyTo, setReplyTo] = useState<NoteFeedItem | null>(null);
  // The original a quote was tapped for: scrolled to and briefly highlighted.
  const [flashId, setFlashId] = useState<string | null>(null);
  // Admin's "Delete for everyone?" step, and the note being deleted.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId,      setDeletingId]      = useState<string | null>(null);
  const listRef  = useRef<HTMLDivElement | null>(null);
  // Is the list scrolled to (near) the bottom? Then new notes keep it there.
  const pinnedRef = useRef(true);
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
        const repliedToMe = newest.reply_to?.created_by_email === userEmail;
        const forMe = mentions(newest.comment, myNamesRef.current);
        const head = repliedToMe ? `${who} replied to you` : forMe ? `${who} mentioned you` : who;
        notify({
          id:     newest.id,
          title:  job ? `${head} — ${job}` : head,
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

  /** The unread divider's "Mark all read": every unread note from someone else, at once. */
  const handleMarkAllRead = useCallback(async (list: NoteFeedItem[]) => {
    const ids = list.map((n) => n.id);
    if (ids.length === 0) return;
    setOptimisticRead((prev) => new Set([...Array.from(prev), ...ids]));
    setUnread((u) => Math.max(0, u - ids.length));
    try {
      await markNotesRead(ids);
    } catch {
      toast.error('Could not mark as read — try again');
      setOptimisticRead((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      setUnread((u) => u + ids.length);
    }
  }, []);

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

  // Realtime nudge: a new (or admin-deleted) stage comment anywhere re-runs the same poll, so
  // unread counts and the read-state join stay computed server-side.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('stage_comments_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stage_comments' }, () => {
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
    pinnedRef.current = true; // open at the newest note, like a chat
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

  // Job search for the composer — same endpoint as the Ctrl K palette, which
  // matches PO, job card, party, job name and PM code, open jobs first.
  useEffect(() => {
    const q = jobQuery.trim();
    if (q.length < 2) { setJobHits([]); return; }
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (!res.ok) return;
        const data = await res.json() as { jobs: PickedJob[] };
        setJobHits(data.jobs);
        setJobActive(0);
      } catch { /* aborted or offline — keep the last results */ }
    }, 200);
    return () => { window.clearTimeout(t); ctrl.abort(); };
  }, [jobQuery]);

  function pickJob(j: PickedJob | null) {
    setJob(j);
    setJobQuery('');
    setJobHits([]);
  }

  function reply(note: NoteFeedItem) {
    pickJob(note.job_id ? {
      id:        note.job_id,
      po_number: note.po_number ?? '',
      party:     note.party ?? '',
      job_name:  note.job_name,
      status:    note.job_status ?? note.stage ?? '',
    } : null);
    setReplyTo(note);
    requestAnimationFrame(() => {
      const el = draftRef.current;
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    });
  }

  async function post(e: React.FormEvent | React.KeyboardEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || posting) return;
    setPosting(true);
    try {
      const res = await fetch(job ? `/api/jobs/${job.id}/comments` : '/api/notes', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...(job && { stage: job.status }), comment: text, reply_to_id: replyTo?.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(body.error ?? 'Could not post the note'); return; }
      setDraft('');
      setReplyTo(null);
      setTab('all');
      pinnedRef.current = true; // show your own note at the bottom
      poll();
    } catch {
      toast.error('Network error. Try again.');
    } finally {
      setPosting(false);
    }
  }

  /** Admin: delete a note for everyone. Gone from this drawer at once; the
   *  realtime nudge takes it off everyone else's. */
  async function deleteNote(note: NoteFeedItem) {
    setDeletingId(note.id);
    try {
      const res = await fetch(`/api/notes/${note.id}`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(body.error ?? 'Could not delete the note'); return; }
      setNotes((prev) => prev
        .filter((n) => n.id !== note.id)
        .map((n) => (n.reply_to?.id === note.id ? { ...n, reply_to: null } : n)));
      if (replyTo?.id === note.id) setReplyTo(null);
      setConfirmDeleteId(null);
      toast.success('Note deleted for everyone');
      poll();
    } catch {
      toast.error('Network error. Try again.');
    } finally {
      setDeletingId(null);
    }
  }

  /** Tap a quote: show the original, switching to All if this tab hides it. */
  function jumpTo(id: string) {
    if (!notes.some((n) => n.id === id)) { toast('That note is older than the last 50.'); return; }
    if (!visible.some((n) => n.id === id)) setTab('all');
    setFlashId(id);
  }

  // Keep the newest note in view while pinned to the bottom: on open, on a
  // tab switch, and when a note arrives. Before paint, so it never flickers.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [open, tab, notes]);

  useEffect(() => {
    if (!flashId) return;
    const el = document.getElementById(`note-${flashId}`);
    if (el) {
      pinnedRef.current = false;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    }
    const t = window.setTimeout(() => setFlashId(null), 1600);
    return () => window.clearTimeout(t);
  }, [flashId, tab]);

  /** A quoted author: "You" for your own notes, like WhatsApp. */
  const nameFor = (email: string | null, dept: string) => (email === userEmail ? 'You' : nameOf(email) || dept);

  // ── Launcher ────────────────────────────────────────────────
  // None of its own: the header's Notes button (and the phone tab bar's)
  // opens the drawer through NOTES_OPEN_EVENT and carries the badge.
  if (!open) return null;

  // The feed arrives newest first; a chat reads oldest first.
  const groups = groupByDay([...visible].reverse());
  // Someone else's unread notes: the divider sits above the first of them.
  const unreadList = visible.filter((n) => !isRead(n) && n.created_by_email !== userEmail);
  const firstUnreadId = unreadList.length ? unreadList[unreadList.length - 1].id : null;

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
                  onClick={() => { pinnedRef.current = true; setTab(t.id); }}
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
        <div
          ref={listRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
          className="flex-1 overflow-y-auto bg-[#F4F7F5] pb-3"
        >
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
            <section key={g.label} aria-label={g.label} className="flex flex-col">
              {/* Day chip, pinned while you scroll its day — as in WhatsApp. */}
              <h3 className="sticky top-2 z-10 mx-auto my-2 rounded-lg bg-white px-3 py-1 text-xs font-medium text-brand-muted shadow-[0_1px_2px_rgba(12,42,32,0.08)]">
                {g.label}
              </h3>
              <ul className="flex flex-col">
                {g.notes.map((note, i) => {
                  const mine  = note.created_by_email === userEmail;
                  const who   = nameOf(note.created_by_email) || note.created_by;
                  const prev  = g.notes[i - 1];
                  // A run of notes by one person shows the name and avatar once.
                  const first = !prev || prev.created_by_email !== note.created_by_email || prev.created_by !== note.created_by || note.id === firstUnreadId;
                  return (
                    <li key={note.id} className="flex flex-col">
                      {note.id === firstUnreadId && (
                        <div className="my-2 flex items-center justify-center gap-2 bg-brand-surface-hover py-1.5 text-xs font-medium text-brand-ink">
                          <span><span className="font-mono">{unreadList.length}</span> unread {unreadList.length === 1 ? 'note' : 'notes'}</span>
                          <span aria-hidden="true" className="text-brand-muted">·</span>
                          <button
                            type="button"
                            onClick={() => handleMarkAllRead(unreadList)}
                            className="min-h-8 rounded-md px-1.5 font-semibold text-brand-primary underline-offset-2 hover:underline"
                          >
                            Mark all read
                          </button>
                        </div>
                      )}
                      <div
                        id={`note-${note.id}`}
                        className={cn(
                          'flex items-start gap-1.5 px-3 transition-colors duration-500',
                          first ? 'mt-2' : 'mt-0.5',
                          mine ? 'justify-end' : 'justify-start',
                          flashId === note.id && 'bg-brand-surface-hover',
                        )}
                      >
                        {!mine && (first ? (
                          <span
                            aria-hidden="true"
                            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-semibold text-white"
                            style={{ background: avatarColour(who) }}
                          >
                            {initials(who)}
                          </span>
                        ) : <span aria-hidden="true" className="w-7 shrink-0" />)}

                        <div className={cn('group flex min-w-0 max-w-[84%] items-center gap-0.5', mine && 'flex-row-reverse')}>
                          <div
                            className={cn(
                              'flex min-w-0 flex-col gap-1 rounded-2xl border px-3 pb-1.5 pt-2 shadow-[0_1px_1px_rgba(12,42,32,0.05)]',
                              mine ? 'border-[#D5E8DC] bg-brand-surface-hover' : 'border-brand-border bg-white',
                              first && (mine ? 'rounded-tr-md' : 'rounded-tl-md'),
                            )}
                          >
                            {!mine && first && (
                              <strong className="text-[13px] font-semibold" style={{ color: avatarColour(who) }} title={note.created_by_email ?? undefined}>
                                {who}
                              </strong>
                            )}
                            {/* The note this replies to — tap to see it in place. */}
                            {note.reply_to && (
                              <button
                                type="button"
                                onClick={() => jumpTo(note.reply_to!.id)}
                                aria-label={`Reply to ${nameFor(note.reply_to.created_by_email, note.reply_to.created_by)}: ${note.reply_to.comment}. Show the original note`}
                                className={cn(
                                  'flex min-h-11 flex-col items-start justify-center gap-0.5 rounded-lg px-2.5 py-1.5 text-left',
                                  mine ? 'bg-white/70 hover:bg-white' : 'bg-[#F1F5F2] hover:bg-brand-surface-hover',
                                )}
                              >
                                <span className="text-xs font-semibold text-brand-ink">{nameFor(note.reply_to.created_by_email, note.reply_to.created_by)}</span>
                                <span className="line-clamp-2 break-words text-xs text-brand-muted">{note.reply_to.comment}</span>
                              </button>
                            )}
                            {note.job_id && (
                              <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-brand-muted">
                                <Link
                                  href={`/admin/jobs/${note.job_id}`}
                                  onClick={() => setOpen(false)}
                                  className="font-mono font-semibold text-brand-ink underline decoration-brand-border underline-offset-2 hover:decoration-brand-primary"
                                >
                                  {note.po_number}
                                </Link>
                                <span>at {note.stage}</span>
                              </span>
                            )}
                            <p className="whitespace-pre-line break-words text-sm leading-normal text-brand-ink">
                              <MentionText text={note.comment} />
                              {/* Room for the time, so it tucks in after a short last line. */}
                              <span aria-hidden="true" className="inline-block w-12" />
                            </p>
                            <time dateTime={note.created_at} className="-mt-4 self-end font-mono text-[11px] text-brand-muted">
                              {format(new Date(note.created_at), 'HH:mm')}
                            </time>
                          </div>
                          <button
                            type="button"
                            onClick={() => reply(note)}
                            aria-label={`Reply to ${mine ? 'your note' : who}`}
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-brand-muted transition-opacity hover:bg-white hover:text-brand-ink focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:hover)]:opacity-0"
                          >
                            <Reply className="h-4 w-4" aria-hidden="true" />
                          </button>
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(note.id)}
                              aria-label={`Delete ${mine ? 'your note' : `${who}'s note`} for everyone`}
                              className="-mx-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-brand-muted transition-opacity hover:bg-white hover:text-brand-danger focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:hover)]:opacity-0"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      </div>
                      {confirmDeleteId === note.id && (
                        <div
                          role="alert"
                          className={cn('mx-3 mt-1 flex w-fit max-w-[84%] flex-col gap-1.5 rounded-xl border border-[#F5C2C2] bg-[#FEF2F2] px-3 py-2 text-xs text-brand-danger', mine ? 'self-end' : 'ml-11 self-start')}
                        >
                          <span className="font-medium">Delete for everyone? This can&apos;t be undone.</span>
                          <span className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => deleteNote(note)}
                            disabled={deletingId === note.id}
                            className="min-h-9 rounded-lg bg-brand-danger px-3 font-semibold text-white hover:opacity-90 disabled:opacity-50"
                          >
                            {deletingId === note.id ? 'Deleting…' : 'Delete'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="min-h-9 rounded-lg px-2 font-medium text-brand-ink hover:bg-white"
                          >
                            Cancel
                          </button>
                          </span>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        {/* Composer — a general note by default; search to file it on a job. */}
        <form onSubmit={post} className="flex flex-col gap-2.5 border-t border-brand-line-soft bg-[#F8FBF9] px-4 pb-4 pt-3.5">
          {replyTo && (
            <div className="flex items-center gap-2 rounded-lg border border-brand-border bg-white py-1.5 pl-3 pr-1.5">
              <div className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-brand-ink">
                  Replying to {nameFor(replyTo.created_by_email, replyTo.created_by)}
                </span>
                <span className="block truncate text-xs text-brand-muted">{replyTo.comment}</span>
              </div>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                aria-label="Cancel reply"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-brand-muted hover:bg-brand-surface-hover hover:text-brand-ink"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          )}
          <div className="relative flex items-center gap-2 text-xs text-brand-muted">
            <span className="shrink-0">Job</span>
            {job ? (
              <>
                <span className="inline-flex min-w-0 items-center gap-1.5 rounded-lg border border-brand-border bg-white py-1 pl-2 pr-1 text-brand-ink">
                  <span className="truncate font-mono font-semibold">{job.po_number} · {job.party}</span>
                  <button
                    type="button"
                    onClick={() => pickJob(null)}
                    aria-label="Remove job — send as a general note"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-brand-muted hover:bg-brand-surface-hover hover:text-brand-ink"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </span>
                <span className="truncate">at {job.status}</span>
              </>
            ) : (
              <>
                <input
                  type="search"
                  role="combobox"
                  aria-label="Attach a job (optional)"
                  aria-expanded={jobHits.length > 0}
                  aria-controls={`${titleId}-jobs`}
                  aria-activedescendant={jobHits.length > 0 ? `${titleId}-job-${jobActive}` : undefined}
                  aria-autocomplete="list"
                  value={jobQuery}
                  onChange={(e) => setJobQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown' && jobHits.length) { e.preventDefault(); setJobActive((i) => (i + 1) % jobHits.length); }
                    else if (e.key === 'ArrowUp' && jobHits.length) { e.preventDefault(); setJobActive((i) => (i - 1 + jobHits.length) % jobHits.length); }
                    else if (e.key === 'Enter' && jobHits[jobActive]) { e.preventDefault(); pickJob(jobHits[jobActive]); }
                    else if (e.key === 'Escape' && jobQuery) { e.stopPropagation(); pickJob(null); }
                  }}
                  placeholder="None — search PO, party or job to attach"
                  className="min-h-9 min-w-0 flex-1 rounded-lg border border-brand-border bg-white px-2.5 text-xs text-brand-ink placeholder:text-brand-muted focus:border-brand-primary focus:outline-none"
                />
                {jobHits.length > 0 && (
                  <ul
                    id={`${titleId}-jobs`}
                    role="listbox"
                    aria-label="Matching jobs"
                    className="absolute bottom-full left-0 right-0 mb-1.5 max-h-64 overflow-y-auto rounded-xl border border-brand-border bg-white py-1 shadow-[0_8px_24px_rgba(12,42,32,0.16)]"
                  >
                    {jobHits.map((j, i) => (
                      <li
                        key={j.id}
                        id={`${titleId}-job-${i}`}
                        role="option"
                        aria-selected={i === jobActive}
                        onMouseDown={(e) => { e.preventDefault(); pickJob(j); }}
                        onMouseEnter={() => setJobActive(i)}
                        className={cn('flex min-h-11 cursor-pointer flex-col justify-center px-3 py-1.5', i === jobActive && 'bg-[#F1F5F2]')}
                      >
                        <span className="truncate font-mono text-xs font-semibold text-brand-ink">{j.po_number} · {j.party}</span>
                        <span className="truncate text-[11px] text-brand-muted">{j.job_name ? `${j.job_name} · ` : ''}{j.status}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
          <div className="flex items-end gap-2">
            <label className="flex-1">
              <span className="sr-only">Write a note</span>
              <MentionTextarea
                inputRef={draftRef}
                rows={1}
                value={draft}
                onValueChange={setDraft}
                // Enter sends, Shift+Enter starts a new line — as in WhatsApp.
                // (While the @ list is open, Enter picks a name instead.)
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) post(e); }}
                placeholder="Type a note · @ to tag someone"
                className="max-h-32 min-h-11 resize-none rounded-3xl [field-sizing:content] border border-brand-border bg-white px-4 py-2.5 text-sm leading-normal text-brand-ink focus:border-brand-primary focus:outline-none"
              />
            </label>
            <button
              type="submit"
              disabled={posting || !draft.trim()}
              aria-label="Post note"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-primary text-white hover:bg-brand-primary-hover disabled:opacity-40"
            >
              <Send className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}
