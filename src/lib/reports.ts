// src/lib/reports.ts
// The Reports page's numbers, computed from rows the API hands over:
// on_time_dispatch_log (one row per full dispatch) and job_status_logs (one
// row per stage change, with qty on dispatches). Pure, so it's testable and
// the API stays a thin fetch.
//
// Months are IST calendar months ('YYYY-MM'), matching on_time_dispatch_log's
// month_key; days are IST days, as the floor counts them.

import { istToday } from '@/lib/jobViews';

export type DispatchRow = {
  job_id:        string;
  dispatched_at: string;          // timestamptz
  is_on_time:    boolean | null;
  month_key:     string | null;
  party:         string;
  po_date:       string | null;   // 'YYYY-MM-DD'
  created_at:    string;          // job created — stands in when po_date is blank
};

export type StatusLogRow = {
  job_id:         string;
  status:         string;
  changed_at:     string;
  qty_dispatched: number | null;
  party:          string;
};

export type MonthKpis = {
  onTimeRate:      number | null;   // whole percent
  jobsDispatched:  number;
  medianPoDays:    number | null;   // PO date → dispatch, days
  labelsShipped:   number;
};

export type Report = {
  month:    string;
  kpis:     MonthKpis;
  previous: MonthKpis;
  trend:    { month: string; rate: number | null; total: number }[];  // oldest first
  waits:    { stage: string; medianDays: number; count: number }[];   // slowest first
  parties:  { party: string; jobs: number; labels: number; onTimeRate: number | null }[];
};

/** 'YYYY-MM' shifted by n months. */
export function addMonths(month: string, n: number): string {
  const d = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** Start of an IST month as an ISO instant, for timestamptz range filters. */
export function istMonthStart(month: string): string {
  return new Date(`${month}-01T00:00:00+05:30`).toISOString();
}

const istMonth = (iso: string) => istToday(new Date(iso)).slice(0, 7);
const istDay   = (iso: string) => istToday(new Date(iso));

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const pct = (yes: number, total: number) => (total > 0 ? Math.round((yes / total) * 100) : null);
const round1 = (n: number) => Math.round(n * 10) / 10;
const monthOf = (d: DispatchRow) => d.month_key ?? istMonth(d.dispatched_at);

const SHIPPED = new Set(['Dispatched', 'Partial Dispatch']);

function kpisFor(month: string, dispatches: DispatchRow[], logs: StatusLogRow[]): MonthKpis {
  const inMonth = dispatches.filter((d) => monthOf(d) === month);
  const judged  = inMonth.filter((d) => d.is_on_time !== null);
  const poDays  = inMonth
    .map((d) => (Date.parse(istDay(d.dispatched_at)) - Date.parse(d.po_date ?? istDay(d.created_at))) / 86_400_000)
    .filter((n) => n >= 0);
  const labels = logs
    .filter((l) => SHIPPED.has(l.status) && istMonth(l.changed_at) === month)
    .reduce((sum, l) => sum + (l.qty_dispatched ?? 0), 0);
  const med = median(poDays);
  return {
    onTimeRate:     pct(judged.filter((d) => d.is_on_time).length, judged.length),
    jobsDispatched: inMonth.length,
    medianPoDays:   med === null ? null : round1(med),
    labelsShipped:  labels,
  };
}

/**
 * Median days a job sits in each stage, for stage spells that began in
 * `month`. A spell runs from one status change to the job's next one; a
 * job's last spell (still in that stage) isn't counted — it hasn't ended.
 */
function waitsFor(month: string, logs: StatusLogRow[]): Report['waits'] {
  const byJob = new Map<string, StatusLogRow[]>();
  for (const l of logs) {
    const list = byJob.get(l.job_id) ?? [];
    list.push(l);
    byJob.set(l.job_id, list);
  }
  const spells = new Map<string, number[]>();
  for (const list of Array.from(byJob.values())) {
    list.sort((a, b) => Date.parse(a.changed_at) - Date.parse(b.changed_at));
    for (let i = 0; i < list.length - 1; i++) {
      const cur = list[i];
      if (istMonth(cur.changed_at) !== month || SHIPPED.has(cur.status) || cur.status === 'PO Closed') continue;
      const d = (Date.parse(list[i + 1].changed_at) - Date.parse(cur.changed_at)) / 86_400_000;
      spells.set(cur.status, [...(spells.get(cur.status) ?? []), d]);
    }
  }
  return Array.from(spells.entries())
    .map(([stage, ds]) => ({ stage, medianDays: round1(median(ds) ?? 0), count: ds.length }))
    .sort((a, b) => b.medianDays - a.medianDays);
}

function partiesFor(month: string, dispatches: DispatchRow[], logs: StatusLogRow[]): Report['parties'] {
  const key = (p: string) => p.trim().replace(/\s+/g, ' ').toUpperCase();
  const acc = new Map<string, { party: string; jobs: Set<string>; labels: number; onTime: number; judged: number }>();
  const get = (party: string) => {
    const k = key(party);
    let a = acc.get(k);
    if (!a) { a = { party: party.trim(), jobs: new Set(), labels: 0, onTime: 0, judged: 0 }; acc.set(k, a); }
    return a;
  };
  for (const l of logs) {
    if (!SHIPPED.has(l.status) || istMonth(l.changed_at) !== month) continue;
    const a = get(l.party);
    a.jobs.add(l.job_id);
    a.labels += l.qty_dispatched ?? 0;
  }
  for (const d of dispatches) {
    if (monthOf(d) !== month) continue;
    const a = get(d.party);
    a.jobs.add(d.job_id);
    if (d.is_on_time !== null) { a.judged += 1; if (d.is_on_time) a.onTime += 1; }
  }
  return Array.from(acc.values())
    .map((a) => ({ party: a.party, jobs: a.jobs.size, labels: a.labels, onTimeRate: pct(a.onTime, a.judged) }))
    .sort((a, b) => b.labels - a.labels || b.jobs - a.jobs)
    .slice(0, 8);
}

export function buildReport(month: string, dispatches: DispatchRow[], logs: StatusLogRow[]): Report {
  const trend = Array.from({ length: 6 }, (_, i) => addMonths(month, i - 5)).map((m) => {
    const rows = dispatches.filter((d) => monthOf(d) === m && d.is_on_time !== null);
    return { month: m, rate: pct(rows.filter((d) => d.is_on_time).length, rows.length), total: rows.length };
  });
  return {
    month,
    kpis:     kpisFor(month, dispatches, logs),
    previous: kpisFor(addMonths(month, -1), dispatches, logs),
    trend,
    waits:    waitsFor(month, logs),
    parties:  partiesFor(month, dispatches, logs),
  };
}
