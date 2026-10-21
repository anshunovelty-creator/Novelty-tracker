// src/lib/reportSync.ts
// The Reports page's copy of Job Separation, kept current a change at a
// time, and checked against the database's own totals.
//
// First load: every row, plus a cursor (the newest updated_at seen). After
// that, GET /api/reports?since=cursor sends only rows written since, and
// mergeRows folds them in by id. When nothing really changed, the merged
// list is the same array, so the analysis (memoised on it) isn't redone.
//
// Every sync also carries report_fingerprint() — lines, cancelled lines,
// ₹ and labels per month, summed by Postgres (migration 082). The page adds
// up its own copy the same way (fingerprintOf); any difference means the
// copy drifted, and the page throws it away and reloads everything.
//
// Pure, so the merge and the check are unit-tested.

import type { SepRow, ShadeCard } from './reports';
import type { DispatchEntry } from './dispatchLedger';

export type MonthPrint = { month: string; lines: number; cancelled: number; value: number; qty: number };

/** What /api/reports answers. `full`: every row; otherwise only rows changed since the cursor sent. */
export type SyncPayload = {
  full:   boolean;
  rows:   SepRow[];
  cursor: string | null;       // newest updated_at in this answer, or the one sent when nothing changed
  print:  MonthPrint[];
};

/**
 * Rows written since a sync can carry an updated_at a little before it: the
 * stamp is the transaction's start, not its commit. Asking from this much
 * earlier catches them; re-sent rows merge as no-ops.
 */
export const OVERLAP_MS = 2 * 60_000;

/** `prev` with `changed` folded in by id. Same array back when nothing actually differs. */
export function mergeRows(prev: SepRow[], changed: SepRow[]): { rows: SepRow[]; changed: number } {
  if (!changed.length) return { rows: prev, changed: 0 };
  const at = new Map(prev.map((r, i) => [r.id, i]));
  const next = [...prev];
  let n = 0, added = false;
  for (const r of changed) {
    const i = at.get(r.id);
    if (i == null) { at.set(r.id, next.length); next.push(r); n++; added = true; }
    else if (JSON.stringify(next[i]) !== JSON.stringify(r)) { next[i] = r; n++; }
  }
  if (!n) return { rows: prev, changed: 0 };
  // Same order a full load gives (by id), so nothing that reads "the first
  // row seen" — a party's display spelling — depends on how rows arrived.
  if (added) next.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { rows: next, changed: n };
}

/** The page's copy, added up the way report_fingerprint() adds up the table. */
export function fingerprintOf(rows: SepRow[]): MonthPrint[] {
  const m = new Map<string, MonthPrint>();
  for (const r of rows) {
    const month = r.day.slice(0, 7);
    const p = m.get(month) ?? { month, lines: 0, cancelled: 0, value: 0, qty: 0 };
    if (r.cancelled) p.cancelled += 1;
    else { p.lines += 1; p.value += r.order_value ?? 0; p.qty += r.quantity ?? 0; }
    m.set(month, p);
  }
  return Array.from(m.values()).sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Where the two disagree, in words — null when they match. ₹ within half a
 * rupee a month: Postgres sums exactly, the page in floating point.
 */
export function printMismatch(db: MonthPrint[], page: MonthPrint[]): string | null {
  const empty = (month: string): MonthPrint => ({ month, lines: 0, cancelled: 0, value: 0, qty: 0 });
  const theirs = new Map(db.map((p) => [p.month, p]));
  const mine = new Map(page.map((p) => [p.month, p]));
  const months = Array.from(new Set([...Array.from(theirs.keys()), ...Array.from(mine.keys())])).sort();
  for (const month of months) {
    const d = theirs.get(month) ?? empty(month), p = mine.get(month) ?? empty(month);
    if (d.lines !== p.lines || d.cancelled !== p.cancelled || d.qty !== p.qty || Math.abs(d.value - p.value) > 0.5) {
      return `${month}: database ${d.lines} lines, ₹${d.value.toFixed(2)}; page ${p.lines} lines, ₹${p.value.toFixed(2)}`;
    }
  }
  return null;
}

/** /api/reports's whole answer. Cards and dispatches come whole every time. */
export type Fetched = SyncPayload & { cards: ShadeCard[]; dispatches: DispatchEntry[]; today: string };

/** What the page holds between syncs. */
export type ReportData = {
  rows: SepRow[]; cards: ShadeCard[]; dispatches: DispatchEntry[]; today: string; cursor: string | null;
  sync: { at: number; full: boolean; changed: number; mismatch: string | null };
};

/** `next` when it differs from `prev`, else `prev` itself — so memos keyed on it hold. */
const keep = <T>(prev: T | undefined, next: T): T => (prev !== undefined && JSON.stringify(prev) === JSON.stringify(next) ? prev : next);

/**
 * The page's copy brought up to date: only the changes since the last sync
 * when there is a copy, then checked against the database's totals. No copy
 * yet, a full reload asked for, or a failed check: every row, fresh.
 * `get(since)` is GET /api/reports (since = null for everything).
 */
export async function syncReports(prev: ReportData | undefined, full: boolean, get: (since: string | null) => Promise<Fetched>): Promise<ReportData> {
  if (prev?.cursor && !full) {
    const d = await get(prev.cursor);
    const m = mergeRows(prev.rows, d.rows);
    if (!printMismatch(d.print, fingerprintOf(m.rows))) {
      return {
        rows: m.rows, cards: keep(prev.cards, d.cards), dispatches: keep(prev.dispatches, d.dispatches), today: d.today, cursor: d.cursor,
        sync: { at: Date.now(), full: false, changed: m.changed, mismatch: null },
      };
    }
  }
  const d = await get(null);
  return {
    rows: keep(prev?.rows, d.rows), cards: keep(prev?.cards, d.cards), dispatches: keep(prev?.dispatches, d.dispatches), today: d.today, cursor: d.cursor,
    // Still off after a full reload: a write landed between the two reads
    // (the next sync settles it), or the page and the database count a row
    // differently — shown, not hidden.
    sync: { at: Date.now(), full: true, changed: d.rows.length, mismatch: printMismatch(d.print, fingerprintOf(d.rows)) },
  };
}
