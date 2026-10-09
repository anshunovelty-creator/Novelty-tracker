'use client';
// src/components/admin/ReportsView.tsx
// The Reports page: a month at a glance (on-time %, jobs dispatched, PO to
// dispatch, labels shipped — each against the month before), the on-time
// trend over six months, where jobs wait, top parties, and CSV exports.
//
// Charts are single-series and plain HTML: every bar carries its value as
// text and a title tooltip, so nothing is read from colour or length alone.
// The current month's bar is the darker green; the rest are a light step.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn, formatQty } from '@/lib/utils';
import { istToday } from '@/lib/jobViews';
import { addMonths, type Report, type MonthKpis } from '@/lib/reports';
import { csvTimestamp, csvDate, type CsvColumn } from '@/lib/export/csv';
import CsvExportButton from './CsvExportButton';
import { Kpi, type KpiDelta } from '@/components/ui/Kpi';

type DispatchEvent = {
  at: string; status: string; qty: number | null; job_card_number: string | null;
  party: string; job_name: string | null; po_number: string; delivery_date: string | null;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName  = (m: string) => MONTHS[+m.slice(5, 7) - 1];
const monthLabel = (m: string) => `${monthName(m)} ${m.slice(0, 4)}`;

/** Indian lakh notation past one lakh: 18,20,000 → "18.2 L". */
function labelsShort(n: number): string {
  return n >= 100_000 ? `${(n / 100_000).toFixed(1)} L` : formatQty(n);
}

const DISPATCH_COLUMNS: CsvColumn<DispatchEvent>[] = [
  { header: 'Dispatched at',   value: (e) => csvTimestamp(e.at) },
  { header: 'Kind',            value: (e) => (e.status === 'Partial Dispatch' ? 'Partial' : 'Full') },
  { header: 'Job Card Number', value: (e) => e.job_card_number },
  { header: 'Party',           value: (e) => e.party },
  { header: 'Job Name',        value: (e) => e.job_name },
  { header: 'PO Number',       value: (e) => e.po_number },
  { header: 'Qty',             value: (e) => e.qty },
  { header: 'Delivery Date',   value: (e) => csvDate(e.delivery_date) },
];

const PARTY_COLUMNS: CsvColumn<Report['parties'][number]>[] = [
  { header: 'Party',          value: (p) => p.party },
  { header: 'Jobs',           value: (p) => p.jobs },
  { header: 'Labels shipped', value: (p) => p.labels },
  { header: 'On time %',      value: (p) => p.onTimeRate },
];

const CARD = 'rounded-2xl border border-brand-border bg-white shadow-[0_2px_8px_rgba(12,42,32,0.04)]';

export default function ReportsView() {
  const thisMonth = istToday().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);

  const q = useQuery({
    queryKey: ['reports', month],
    queryFn: async () => {
      const res  = await fetch(`/api/reports?month=${month}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load the report');
      return data as { report: Report; dispatches: DispatchEvent[] };
    },
    staleTime: 60_000,
  });
  const r = q.data?.report;
  const prev = addMonths(month, -1);
  const trend = r?.trend ?? Array.from({ length: 6 }, (_, i) => ({ month: addMonths(month, i - 5), rate: null as number | null, total: 0 }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px] font-semibold leading-9 tracking-[-0.025em] text-brand-ink">Reports</h1>
          <p className="mt-1.5 max-w-[72ch] text-sm text-brand-muted">
            How the floor performed — on-time delivery, where jobs wait, and who orders most.
          </p>
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Month">
          <button
            type="button"
            onClick={() => setMonth(prev)}
            aria-label={`Previous month, ${monthLabel(prev)}`}
            className="inline-flex h-11 w-11 items-center justify-center rounded-[10px] border border-brand-border bg-white text-brand-ink hover:bg-brand-surface-alt"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <span className="min-w-[96px] text-center font-mono text-sm font-semibold uppercase text-brand-ink" aria-live="polite">
            {monthLabel(month)}
          </span>
          <button
            type="button"
            onClick={() => setMonth(addMonths(month, 1))}
            disabled={month >= thisMonth}
            aria-label={`Next month, ${monthLabel(addMonths(month, 1))}`}
            className="inline-flex h-11 w-11 items-center justify-center rounded-[10px] border border-brand-border bg-white text-brand-ink hover:bg-brand-surface-alt disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {q.error ? (
        <div className={cn(CARD, 'px-5 py-10 text-center text-sm text-brand-danger')} role="alert">
          {(q.error as Error).message}
        </div>
      ) : (
        <>
          {/* Month at a glance */}
          <section aria-label="Month at a glance" className={cn(CARD, 'flex flex-wrap')}>
            <Kpi label="Dispatched on time" loading={!r}
              value={r?.kpis.onTimeRate != null ? `${r.kpis.onTimeRate}%` : '—'}
              delta={r && delta(r.kpis, r.previous, 'onTimeRate', prev, ' pts', true)} />
            <Kpi label="Jobs dispatched" loading={!r}
              value={r ? String(r.kpis.jobsDispatched) : '—'}
              delta={r && delta(r.kpis, r.previous, 'jobsDispatched', prev, '', true)} />
            <Kpi label="PO to dispatch, median" loading={!r}
              value={r?.kpis.medianPoDays != null ? `${r.kpis.medianPoDays} d` : '—'}
              delta={r && delta(r.kpis, r.previous, 'medianPoDays', prev, ' d', false)} />
            <Kpi label="Labels shipped" loading={!r}
              value={r ? labelsShort(r.kpis.labelsShipped) : '—'}
              delta={r && { text: r.kpis.labelsShipped >= 100_000 ? 'lakh labels, full and partial' : 'full and partial dispatches', tone: 'muted' }} />
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* On-time trend */}
            <section aria-label="On-time rate by month" className={cn(CARD, 'p-5 sm:p-6')}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-base font-semibold text-brand-ink">On-time dispatch rate</h2>
                <span className="text-xs text-brand-muted">last 6 months · full dispatches</span>
              </div>
              <div className="mt-6 flex h-44 items-end gap-3 border-b border-brand-border">
                {trend.map((t) => (
                  <div
                    key={t.month}
                    className="flex h-full flex-1 flex-col items-center justify-end gap-1.5"
                    title={t.rate != null ? `${monthLabel(t.month)}: ${t.rate}% of ${t.total} dispatches on time` : `${monthLabel(t.month)}: no dispatches`}
                  >
                    <span className="font-mono text-xs font-medium text-brand-ink">{t.rate != null ? `${t.rate}%` : '—'}</span>
                    {t.rate != null && (
                      <span
                        className={cn('w-full max-w-12 rounded-t', t.month === month ? 'bg-brand-primary' : 'bg-green-200')}
                        style={{ height: `calc((100% - 1.5rem) * ${Math.max(t.rate, 2) / 100})` }}
                      />
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-3">
                {trend.map((t) => (
                  <span key={t.month} className={cn('flex-1 text-center font-mono text-xs uppercase', t.month === month ? 'font-semibold text-brand-ink' : 'text-brand-muted')}>
                    {monthName(t.month)}
                  </span>
                ))}
              </div>
            </section>

            {/* Where jobs wait */}
            <section aria-label="Where jobs wait" className={cn(CARD, 'p-5 sm:p-6')}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-base font-semibold text-brand-ink">Where jobs wait</h2>
                <span className="text-xs text-brand-muted">median days in stage · {monthName(month)}</span>
              </div>
              {!r ? <Skeleton rows={5} /> : r.waits.length === 0 ? (
                <p className="py-10 text-center text-sm text-brand-muted">No stage changes recorded this month.</p>
              ) : (
                <>
                  <ul className="mt-4 space-y-2.5">
                    {r.waits.slice(0, 7).map((w, i) => (
                      <li key={w.stage} className="grid grid-cols-[minmax(0,9.5rem)_1fr_3.5rem] items-center gap-3"
                          title={`${w.stage}: median ${w.medianDays} days over ${w.count} job${w.count === 1 ? '' : 's'}`}>
                        <span className="truncate text-[13px] text-brand-ink">{w.stage}</span>
                        <span className="h-2.5 overflow-hidden rounded-full bg-brand-sunken">
                          <span
                            className={cn('block h-full rounded-full', i === 0 ? 'bg-brand-primary' : 'bg-green-300')}
                            style={{ width: `${Math.max((w.medianDays / (r.waits[0].medianDays || 1)) * 100, 2)}%` }}
                          />
                        </span>
                        <span className="text-right font-mono text-[13px] font-medium text-brand-ink">{w.medianDays} d</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-4 text-[13px] text-brand-muted">
                    <strong className="font-semibold text-brand-ink">{r.waits[0].stage}</strong> is where jobs waited longest
                    this month — a median of {r.waits[0].medianDays} days across {r.waits[0].count} job{r.waits[0].count === 1 ? '' : 's'}.
                  </p>
                </>
              )}
            </section>
          </div>

          <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
            {/* Top parties */}
            <section aria-label="Top parties" className={cn(CARD, 'overflow-hidden')}>
              <h2 className="px-5 pt-5 text-base font-semibold text-brand-ink sm:px-6">Top parties by labels shipped</h2>
              {!r ? <div className="px-5 pb-5"><Skeleton rows={4} /></div> : r.parties.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-brand-muted">Nothing dispatched in {monthLabel(month)}.</p>
              ) : (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[420px] border-collapse text-sm">
                    <thead>
                      <tr>
                        <th className="px-5 py-2.5 text-left text-xs font-medium text-brand-muted sm:px-6">Party</th>
                        <th className="px-3 py-2.5 text-right text-xs font-medium text-brand-muted">Jobs</th>
                        <th className="px-3 py-2.5 text-right text-xs font-medium text-brand-muted">Labels</th>
                        <th className="px-5 py-2.5 text-right text-xs font-medium text-brand-muted sm:px-6">On time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.parties.map((p) => (
                        <tr key={p.party} className="border-t border-brand-line-soft even:bg-brand-surface-alt">
                          <td className="px-5 py-3 font-semibold text-brand-ink sm:px-6">{p.party}</td>
                          <td className="px-3 py-3 text-right font-mono text-brand-ink">{p.jobs}</td>
                          <td className="px-3 py-3 text-right font-mono text-brand-ink">{labelsShort(p.labels)}</td>
                          <td className="px-5 py-3 text-right font-mono text-brand-ink sm:px-6">{p.onTimeRate != null ? `${p.onTimeRate}%` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Exports */}
            <section aria-label="Exports" className={cn(CARD, 'p-5 sm:p-6')}>
              <h2 className="text-base font-semibold text-brand-ink">Export to Excel</h2>
              <p className="mt-1 text-[13px] text-brand-muted">CSV for {monthLabel(month)}. Opens straight in Excel.</p>
              <div className="mt-4 flex flex-col gap-2">
                <ExportRow title="Every dispatch, full and partial" count={q.data?.dispatches.length}>
                  <CsvExportButton rows={q.data?.dispatches ?? []} columns={DISPATCH_COLUMNS} filename={`dispatches-${month}`} label="CSV" />
                </ExportRow>
                <ExportRow title="Top parties" count={r?.parties.length}>
                  <CsvExportButton rows={r?.parties ?? []} columns={PARTY_COLUMNS} filename={`top-parties-${month}`} label="CSV" />
                </ExportRow>
              </div>
              <p className="mt-4 text-xs text-brand-muted">The whole database, every table, is under Export in the header.</p>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

/** "▲ 4 pts vs Aug" — green when it moved the good way, amber when not. */
function delta(now: MonthKpis, before: MonthKpis, key: 'onTimeRate' | 'jobsDispatched' | 'medianPoDays', prev: string, unit: string, upIsGood: boolean): KpiDelta {
  const a = now[key], b = before[key];
  if (a == null) return { text: 'no full dispatches yet', tone: 'muted' };
  if (b == null) return { text: `nothing to compare in ${monthName(prev)}`, tone: 'muted' };
  const d = Math.round((a - b) * 10) / 10;
  if (d === 0) return { text: `same as ${monthName(prev)}`, tone: 'muted' };
  const good = d > 0 === upIsGood;
  return { text: `${d > 0 ? '▲' : '▼'} ${Math.abs(d)}${unit} vs ${monthName(prev)}`, tone: good ? 'good' : 'bad' };
}

function ExportRow({ title, count, children }: { title: string; count: number | undefined; children: React.ReactNode }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-brand-border px-4 py-2">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-brand-ink">{title}</span>
        <span className="block font-mono text-xs text-brand-muted">{count == null ? '…' : `${count} row${count === 1 ? '' : 's'}`}</span>
      </span>
      {children}
    </div>
  );
}

function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="mt-4 space-y-2.5" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="h-5 rounded bg-brand-sunken" />)}
    </div>
  );
}
