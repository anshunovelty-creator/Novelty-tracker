// src/lib/dispatchLedger.ts
// Dispatch entries (pending_dispatch_notifications) as the record of what
// went out, matched to the Job Separation line each one ships. Pure: the
// dispatch API's checks, the Dispatch history tab and Reports share it.
//
// Matching, done on every read rather than stored, so a line entered or
// corrected after the dispatch still picks it up: same PO (trimmed, any
// case) and same PM code (pmKey). An entry with no PM code matches when its
// PO has exactly one live line. Two live lines with the same PO and PM code
// match neither; guessing would put the labels against the wrong one.
//
// An entry counts once it's confirmed (its first team email, or confirmed
// by hand) and not removed (migration 085). Entry status can't close a
// line: the form defaults to "Dispatched", so most part dispatches carry
// it. A line is pending until its entries add up to the order.
//
// Reports start at TRACKED_FROM: the day the dispatch team began entering
// every dispatch. Before it only a fraction went in (86 team emails
// against ~1,000 order lines, Aug–Oct 2026), so earlier orders would all
// look pending and earlier entries would undercount what went out. Those
// entries stay in the History tab; they just don't feed the figures.

import { pmKey, partyKey, groupKey, rowMatches, jobCardKind, type SepRow, type Period, type Filter } from './reports';

/** Every dispatch is entered from this IST day on (agreed 2026-10-21). */
export const TRACKED_FROM = '2026-10-21';

/** An entry for the same PO and PM code this many days back is flagged as a possible double entry. */
export const DUPLICATE_DAYS = 3;

export const poKey = (po: string | null | undefined) => (po ?? '').trim().toUpperCase();

type LineLike = { id: string; po_no: string | null; pm_code: string | null };

/** The order line an entry ships against, or null. `lines`: live lines (any PO; others are skipped). */
export function lineFor<L extends LineLike>(po: string | null, pm: string | null, lines: L[]): L | null {
  const k = poKey(po);
  if (!k) return null;
  const same = lines.filter((l) => poKey(l.po_no) === k);
  const code = pmKey(pm);
  const hits = code ? same.filter((l) => pmKey(l.pm_code) === code) : same;
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Labels entered against each line: line id → total. `lines`: every live
 * line that shares a PO with the ones asked about (so an ambiguous PO + PM
 * code stays unmatched); `entries`: the entries that count.
 */
export function dispatchedByLine<L extends LineLike>(lines: L[], entries: { po_number: string; pm_code: string | null; qty: number | null }[]): Map<string, number> {
  const byPo = new Map<string, L[]>();
  for (const l of lines) {
    const k = poKey(l.po_no);
    if (k) byPo.set(k, [...(byPo.get(k) ?? []), l]);
  }
  const out = new Map<string, number>();
  for (const e of entries) {
    const l = lineFor(e.po_number, e.pm_code, byPo.get(poKey(e.po_number)) ?? []);
    if (l) out.set(l.id, (out.get(l.id) ?? 0) + (e.qty ?? 0));
  }
  return out;
}

const fmt = (n: number) => n.toLocaleString('en-IN');
const shortDay = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

/**
 * What to tell Dispatch before saving an entry. Empty = nothing to say.
 * `others`: live entries already against the same line (or, with no line,
 * the same PO and PM code), not counting the one being edited.
 */
export function entryWarnings({ line, others, qty, now }: {
  line:   { quantity: number | null } | null;
  others: { qty: number | null; created_at: string }[];
  qty:    number | null;
  now:    Date;
}): string[] {
  const out: string[] = [];
  const cutoff = now.getTime() - DUPLICATE_DAYS * 86_400_000;
  const recent = others.filter((o) => Date.parse(o.created_at) >= cutoff);
  if (recent.length) {
    const list = recent.map((o) => `${shortDay(o.created_at)} (${o.qty != null ? `${fmt(o.qty)} labels` : 'no qty'})`).join(', ');
    out.push(`Already entered for this PO and PM code in the last ${DUPLICATE_DAYS} days: ${list}. Adding it again counts it twice.`);
  }
  if (!line) {
    out.push('No order line in Job Separation has this PO and PM code, so Reports can\'t count this against an order.');
  } else if (line.quantity && qty) {
    const total = others.reduce((s, o) => s + (o.qty ?? 0), 0) + qty;
    if (total > line.quantity) {
      out.push(`The order is for ${fmt(line.quantity)} labels. With this entry ${fmt(total)} are entered against it, ${fmt(total - line.quantity)} more than ordered.`);
    }
  }
  return out;
}

// ── Reports ───────────────────────────────────────────────────

/** A confirmed, live entry as Reports reads it. `day`: IST day it was confirmed. */
export type DispatchEntry = { id: string; party: string; po: string; pm: string | null; qty: number; day: string };

export type LineStatus = {
  line:     SepRow;
  shipped:  number;          // labels entered against it, up to today
  pending:  number;          // ordered − shipped, never below 0
  over:     number;          // shipped − ordered, when more went out
  entries:  number;
  first:    string | null;   // first dispatch day
  done:     string | null;   // the day the entries reached the order
  ageDays:  number;          // PO date → today
};

type Sum = { qty: number; value: number; entries: number };

export type DispatchView = {
  since:       string;   // TRACKED_FROM; orders and entries dated before it aren't counted
  shipped:     Sum;      // went out in the period, by dispatch day, against matched lines
  prevShipped: Sum;
  unmatched:   Sum;      // the period's entries not tied to an order line (value unknown, so 0)
  ordered: {             // the period's orders (by PO date) from `since` on, and how far they've gone
    lines: number; qty: number; value: number;
    shippedQty: number; shippedValue: number; pendingQty: number; pendingValue: number;
    full: number; part: number; none: number;
  };
  untracked:   { lines: number; value: number };   // the period's orders dated before `since`
  open:        { lines: number; qty: number; value: number; ages: { label: string; lines: number; value: number }[] };
  held:        { lines: number; value: number };   // pending, but JC status says hold or cancel — kept out of `open`
  openLines:   LineStatus[];                       // `open`, oldest PO first
  parties:     { key: string; party: string; lines: number; value: number; oldestDays: number }[];
  over:        LineStatus[];                       // more went out than ordered, biggest excess first
  leadFirst:   number | null;   // median days, PO → first dispatch, for lines first dispatched in the period
  leadDone:    number | null;   // median days, PO → fully dispatched, for lines completed in the period
  months:      { month: string; ordered: number; shipped: number }[];   // ₹ by month from `since`
};

const AGES: [string, number][] = [['0–7 days', 7], ['8–15 days', 15], ['16–30 days', 30], ['31–60 days', 60], ['Over 60 days', Infinity]];
const DAY = 86_400_000;
const daysFrom = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const inPeriod = (d: string, p: Period) => d >= p.from && d <= p.to;
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** Dispatched and pending, for the period and as of today. Null before tracking starts. */
export function dispatchOf(all: SepRow[], entries: DispatchEntry[], period: Period, previous: Period, filter: Filter, today: string, since = TRACKED_FROM): DispatchView | null {
  if (today < since) return null;
  const counted = entries.filter((e) => e.day >= since && e.day <= today);
  const matches = rowMatches(filter);

  const live = all.filter((r) => !r.cancelled);
  const byPo = new Map<string, SepRow[]>();
  for (const r of live) {
    const k = poKey(r.po_no);
    if (k) byPo.set(k, [...(byPo.get(k) ?? []), r]);
  }

  const lineOf = new Map<string, SepRow>();             // entry id → line
  const perLine = new Map<string, DispatchEntry[]>();   // line id → its entries
  const loose: DispatchEntry[] = [];
  for (const e of counted) {
    const line = lineFor(e.po, e.pm, byPo.get(poKey(e.po)) ?? []);
    if (!line) { loose.push(e); continue; }
    lineOf.set(e.id, line);
    perLine.set(line.id, [...(perLine.get(line.id) ?? []), e]);
  }

  const statusOf = (line: SepRow): LineStatus => {
    const es = [...(perLine.get(line.id) ?? [])].sort((x, y) => x.day.localeCompare(y.day));
    const ordered = line.quantity ?? 0;
    let shipped = 0, done: string | null = null;
    for (const e of es) {
      shipped += e.qty;
      if (!done && ordered > 0 && shipped >= ordered) done = e.day;
    }
    return {
      line, shipped, entries: es.length, first: es[0]?.day ?? null, done,
      pending: Math.max(0, ordered - shipped), over: ordered > 0 ? Math.max(0, shipped - ordered) : 0,
      ageDays: daysFrom(line.day, today),
    };
  };

  const shippedIn = (p: Period): Sum => {
    const s: Sum = { qty: 0, value: 0, entries: 0 };
    for (const e of counted) {
      const l = lineOf.get(e.id);
      if (!l || !matches(l) || !inPeriod(e.day, p)) continue;
      s.qty += e.qty; s.value += e.qty * (l.rate ?? 0); s.entries++;
    }
    return s;
  };

  // A loose entry has no line, so no unit; only the customer filter applies.
  const unmatched: Sum = { qty: 0, value: 0, entries: 0 };
  for (const e of loose) {
    if (!inPeriod(e.day, period)) continue;
    if ((filter.group && groupKey(e.party) !== filter.group) || (filter.party && partyKey(e.party) !== filter.party)) continue;
    unmatched.qty += e.qty; unmatched.entries++;
  }

  const mine = live.filter(matches);
  const tracked = mine.filter((r) => r.day >= since && r.day <= today).map(statusOf);

  const periodRows = mine.filter((r) => inPeriod(r.day, period));
  const untrackedRows = periodRows.filter((r) => r.day < since);
  const ordered = { lines: 0, qty: 0, value: 0, shippedQty: 0, shippedValue: 0, pendingQty: 0, pendingValue: 0, full: 0, part: 0, none: 0 };
  for (const s of tracked) {
    if (!inPeriod(s.line.day, period)) continue;
    const q = s.line.quantity ?? 0, rate = s.line.rate ?? 0, got = Math.min(s.shipped, q);
    ordered.lines++; ordered.qty += q; ordered.value += s.line.order_value ?? 0;
    ordered.shippedQty += got; ordered.shippedValue += got * rate;
    ordered.pendingQty += s.pending; ordered.pendingValue += s.pending * rate;
    if (s.pending === 0) ordered.full++; else if (s.shipped > 0) ordered.part++; else ordered.none++;
  }

  const pending = tracked.filter((s) => s.pending > 0);
  const isHeld = (s: LineStatus) => jobCardKind(s.line.jc_status) === 'On hold / cancelled';
  const openLines = pending.filter((s) => !isHeld(s)).sort((x, y) => x.line.day.localeCompare(y.line.day));
  const valueOf = (s: LineStatus) => s.pending * (s.line.rate ?? 0);
  const heldLines = pending.filter(isHeld);

  const ages = AGES.map(([label]) => ({ label, lines: 0, value: 0 }));
  const parties = new Map<string, { key: string; party: string; lines: number; value: number; oldestDays: number }>();
  for (const s of openLines) {
    const b = ages[AGES.findIndex(([, max]) => s.ageDays <= max)];
    b.lines++; b.value += valueOf(s);
    const k = partyKey(s.line.party);
    const p = parties.get(k) ?? { key: k, party: s.line.party.trim(), lines: 0, value: 0, oldestDays: 0 };
    p.lines++; p.value += valueOf(s); p.oldestDays = Math.max(p.oldestDays, s.ageDays);
    parties.set(k, p);
  }

  // Over-dispatch is a fact about the entries, whenever the order was placed.
  const over = mine.filter((r) => perLine.has(r.id)).map(statusOf).filter((s) => s.over > 0)
    .sort((x, y) => y.over * (y.line.rate ?? 0) - x.over * (x.line.rate ?? 0));

  const months = new Map<string, { month: string; ordered: number; shipped: number }>();
  const monthOf = (d: string) => {
    const m = d.slice(0, 7);
    if (!months.has(m)) months.set(m, { month: m, ordered: 0, shipped: 0 });
    return months.get(m)!;
  };
  for (const r of mine) if (r.day >= since && r.day <= today) monthOf(r.day).ordered += r.order_value ?? 0;
  for (const e of counted) {
    const l = lineOf.get(e.id);
    if (l && matches(l)) monthOf(e.day).shipped += e.qty * (l.rate ?? 0);
  }

  return {
    since,
    shipped: shippedIn(period),
    prevShipped: shippedIn(previous),
    unmatched,
    ordered,
    untracked: { lines: untrackedRows.length, value: untrackedRows.reduce((s, r) => s + (r.order_value ?? 0), 0) },
    open: {
      lines: openLines.length,
      qty: openLines.reduce((s, x) => s + x.pending, 0),
      value: openLines.reduce((s, x) => s + valueOf(x), 0),
      ages,
    },
    held: { lines: heldLines.length, value: heldLines.reduce((s, x) => s + valueOf(x), 0) },
    openLines,
    parties: Array.from(parties.values()).sort((a, b) => b.value - a.value),
    over,
    leadFirst: median(tracked.filter((s) => s.first && inPeriod(s.first, period)).map((s) => daysFrom(s.line.day, s.first!))),
    leadDone:  median(tracked.filter((s) => s.done && inPeriod(s.done, period)).map((s) => daysFrom(s.line.day, s.done!))),
    months: Array.from(months.values()).sort((a, b) => a.month.localeCompare(b.month)),
  };
}
