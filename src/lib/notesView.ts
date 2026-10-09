// src/lib/notesView.ts
// ============================================================
// How the internal-notes drawer slices the feed: All / Unread / Mentions me,
// and the Today / Yesterday / date headings between them. Pure, so the
// drawer and its tests read the same rules.
// ============================================================

export type NotesTab = 'all' | 'unread' | 'mentions';

type NoteLike = {
  comment: string;
  created_at: string;
  created_by_email: string | null;
  /** The note this one replies to, if any (migration 078). */
  reply_to?: { created_by_email: string | null } | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A note id (a UUID) from a request, or null — for reply_to_id and DELETE /api/notes/[id]. */
export function parseNoteId(v: unknown): string | null {
  return typeof v === 'string' && UUID.test(v) ? v : null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Does `text` tag one of `names` with @ — "@QC", "@qc", "@Dispatch-Team"?
 * Matched without case or punctuation so "@prepressteam" finds "Prepress Team".
 * An email address ("qc@novelty.in") is not a tag: the @ must start a word.
 */
export function mentions(text: string, names: readonly string[]): boolean {
  const wanted = new Set(names.map(norm).filter(Boolean));
  if (wanted.size === 0) return false;
  const tags = text.match(/(?:^|[^A-Za-z0-9])@[A-Za-z0-9][A-Za-z0-9_-]*/g) ?? [];
  return tags.some((t) => wanted.has(norm(t.slice(t.indexOf('@') + 1))));
}

/** Was this note posted after everything already seen (`seenUpTo`, ms)?
 *  The Notes drawer alerts only for such a note. By time, not id: an admin
 *  deleting the newest note leaves an older one on top, which isn't new. */
export function isNewerThan(createdAt: string, seenUpTo: number | null): boolean {
  return Date.parse(createdAt) > (seenUpTo ?? 0);
}

/** How long after posting the author can still edit a note. */
export const EDIT_WINDOW_MS = 15 * 60 * 1000;

/** Only the author, and only within EDIT_WINDOW_MS of posting. The server
 *  (PATCH /api/notes/[id]) applies the same rule; the drawer uses it to
 *  decide whether to show the pencil. */
export function canEditNote(
  note: { created_by_email: string | null; created_at: string },
  me: string,
  now: number = Date.now(),
): boolean {
  if (!me || note.created_by_email !== me) return false;
  const age = now - Date.parse(note.created_at);
  return age >= 0 && age <= EDIT_WINDOW_MS;
}

export function filterNotes<T extends NoteLike>(
  notes: readonly T[],
  tab: NotesTab,
  opts: { isRead: (n: T) => boolean; me: string; myNames: readonly string[] },
): T[] {
  if (tab === 'unread')   return notes.filter((n) => !opts.isRead(n) && n.created_by_email !== opts.me);
  // A reply to one of my notes is addressed to me, tag or not.
  if (tab === 'mentions') return notes.filter((n) => mentions(n.comment, opts.myNames) || (n.reply_to?.created_by_email === opts.me && n.created_by_email !== opts.me));
  return notes.slice();
}

/** "Today", "Yesterday", or "03 Oct" — in the browser's time zone. */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

/** Consecutive runs of notes under one day heading, newest first as given. */
export function groupByDay<T extends NoteLike>(notes: readonly T[], now: Date = new Date()): { label: string; notes: T[] }[] {
  const out: { label: string; notes: T[] }[] = [];
  for (const n of notes) {
    const label = dayLabel(n.created_at, now);
    const last = out[out.length - 1];
    if (last && last.label === label) last.notes.push(n);
    else out.push({ label, notes: [n] });
  }
  return out;
}
