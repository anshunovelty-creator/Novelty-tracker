// src/lib/notesView.ts
// ============================================================
// How the internal-notes drawer slices the feed: All / Unread / Mentions me,
// and the Today / Yesterday / date headings between them. Pure, so the
// drawer and its tests read the same rules.
// ============================================================

export type NotesTab = 'all' | 'unread' | 'mentions';

type NoteLike = { comment: string; created_at: string; created_by_email: string | null };

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

export function filterNotes<T extends NoteLike>(
  notes: readonly T[],
  tab: NotesTab,
  opts: { isRead: (n: T) => boolean; me: string; myNames: readonly string[] },
): T[] {
  if (tab === 'unread')   return notes.filter((n) => !opts.isRead(n) && n.created_by_email !== opts.me);
  if (tab === 'mentions') return notes.filter((n) => mentions(n.comment, opts.myNames));
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
