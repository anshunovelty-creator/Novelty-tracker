'use client';
// src/components/admin/ReportsView.tsx
// The Reports page: the order book from Job Separation, sliced every way the
// office asks about it — how much came in and against what, which unit it
// lands on, which parties and products it comes from, how big orders run,
// how much is repeat artwork, how much still needs a job card.
//
// One fetch brings every row; period, unit and party are applied here
// (lib/reports.ts analyse), so switching any of them is instant. Tapping a
// party or a unit narrows the whole page to it.
//
// Live: the page asks every 30 s whether Job Separation changed (a few
// bytes, useRefetchOnChange) and only then syncs — fetching just the rows
// written since its last sync and folding them into the copy it holds
// (lib/reportSync.ts). Every sync is checked against the database's own
// per-month totals; if the copy has drifted it reloads everything. When
// nothing really changed the rows keep their identity, so the analysis
// isn't recomputed. A slow poll keeps "today" right overnight.
//
// Charts are single-series and plain HTML: every bar carries its value as
// text and a title tooltip, so nothing is read from colour or length alone.
//
// Dispatch tab: what went out and what's still to go, from the dispatch
// team's entries matched to order lines (lib/dispatchLedger.ts). Same
// period and filters; a change on Dispatch Emails syncs it like any other.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  analyse, presetPeriod, partyOptions, partyKey, earliestDay, unitLabel, UNITS, SEGMENTS, SEGMENT_ACTIONS,
  type SepRow, type Period, type Preset, type Analysis, type PartyRow, type ProductRow, type Slice, type Totals, type Cycle,
  type CustomerRow, type Segment, type RateCheck, type BridgeKey, type RowCheck, type ShadeCard, type CardTrack, type ProductLife, type ProductStage, PRODUCT_STAGES,
} from '@/lib/reports';
import { csvDate, type CsvColumn } from '@/lib/export/csv';
import CsvExportButton from './CsvExportButton';
import { useRefetchOnChange } from '@/hooks/useRefetchOnChange';
import { syncReports, type ReportData, type Fetched } from '@/lib/reportSync';
import { Kpi, type KpiDelta } from '@/components/ui/Kpi';
import Link from 'next/link';
import { dispatchOf, type DispatchView, type LineStatus } from '@/lib/dispatchLedger';

const CARD = 'rounded-2xl border border-brand-border bg-white shadow-[0_2px_8px_rgba(12,42,32,0.04)]';
const FOCUS = 'focus:border-brand-primary focus:outline-none focus:ring-4 focus:ring-[rgba(16,85,63,0.18)]';
const MON  = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── Formatting ────────────────────────────────────────────────

// Reports alone count the international way (thousand, million, billion);
// the rest of the app stays on lakh/crore. Every figure on this page goes
// through these, so none slips back to en-IN grouping.
const intl = (n: number, dp = 0) => n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
/** Big numbers short: 5.36M, 1.20B; under a million in full: 405,622. */
function short(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return intl(Math.round(n));
}
const rupees = (n: number) => `₹${short(n)}`;
const rupeesFull = (n: number) => `₹${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const rate = (n: number | null) => (n == null ? '—' : `₹${intl(n, 2)}`);
const qtyShort = short;
const qtyFull = (n: number) => intl(n);
const dayLabel = (d: string, year = false) => `${+d.slice(8, 10)} ${MON[+d.slice(5, 7) - 1]}${year ? ` ${d.slice(0, 4)}` : ''}`;
const periodLabel = (p: Period) =>
  p.from === p.to ? dayLabel(p.from, true) : `${dayLabel(p.from, p.from.slice(0, 4) !== p.to.slice(0, 4))} – ${dayLabel(p.to, true)}`;
const timeLabel = (ms: number) => new Date(ms).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const round2 = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);

/** "▲ 12% vs 1 Sep – 13 Sep" — green up, amber down. */
function change(now: number | null, before: number | null, vs: string): KpiDelta {
  if (!now) return { text: 'nothing in this period', tone: 'muted' };
  if (!before) return { text: 'no data before to compare', tone: 'muted' };
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return { text: `same as ${vs}`, tone: 'muted' };
  return { text: `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs ${vs}`, tone: pct > 0 ? 'good' : 'bad' };
}

function rateDelta(t: Totals, p: Totals, vs: string): KpiDelta {
  if (t.avgRate == null) return { text: 'nothing in this period', tone: 'muted' };
  if (p.avgRate == null) return { text: 'no data before to compare', tone: 'muted' };
  const d = t.avgRate - p.avgRate;
  if (Math.abs(d) < 0.005) return { text: `same as ${vs}`, tone: 'muted' };
  return { text: `${d > 0 ? '▲' : '▼'} ₹${Math.abs(d).toFixed(2)} vs ${vs}`, tone: d > 0 ? 'good' : 'bad' };
}

// ── CSV columns ───────────────────────────────────────────────

const LINE_COLUMNS: CsvColumn<SepRow>[] = [
  { header: 'Sr No',         value: (r) => r.sr_no },
  { header: 'PO Date',       value: (r) => csvDate(r.day) },
  { header: 'Party',         value: (r) => r.party },
  { header: 'PO No',         value: (r) => r.po_no },
  { header: 'PM Code',       value: (r) => r.pm_code },
  { header: 'Material Name', value: (r) => r.material_name },
  { header: 'Unit',          value: (r) => r.unit },
  { header: 'Quantity',      value: (r) => r.quantity },
  { header: 'Rate',          value: (r) => r.rate },
  { header: 'Order Value',   value: (r) => r.order_value },
  { header: 'JC Status',     value: (r) => r.jc_status },
  { header: 'AW Send To',    value: (r) => r.aw_send_to },
];

const PARTY_COLUMNS: CsvColumn<PartyRow>[] = [
  { header: 'Party',                 value: (p) => p.party },
  { header: 'Order value',           value: (p) => round2(p.value) },
  { header: 'Share %',               value: (p) => p.share },
  { header: 'Orders',                value: (p) => p.orders },
  { header: 'POs',                   value: (p) => p.pos },
  { header: 'Labels',                value: (p) => p.qty },
  { header: 'Avg rate per label',    value: (p) => round2(p.avgRate) },
  { header: 'Unit 1 value',          value: (p) => round2(p.byUnit['1'] ?? 0) },
  { header: 'Unit 2 value',          value: (p) => round2(p.byUnit['2'] ?? 0) },
  { header: 'Units 1 & 2 value',     value: (p) => round2(p.byUnit['1&2'] ?? 0) },
  { header: 'Previous period value', value: (p) => round2(p.prevValue) },
  { header: 'Last PO date',          value: (p) => csvDate(p.lastDay) },
];

const PRODUCT_COLUMNS: CsvColumn<ProductRow>[] = [
  { header: 'PM Code',            value: (p) => p.pm_code },
  { header: 'Material Name',      value: (p) => p.material },
  { header: 'Order value',        value: (p) => round2(p.value) },
  { header: 'Orders',             value: (p) => p.orders },
  { header: 'Labels',             value: (p) => p.qty },
  { header: 'Parties',            value: (p) => p.parties },
  { header: 'Avg rate per label', value: (p) => round2(p.avgRate) },
];

// ── Page ──────────────────────────────────────────────────────

const PRESETS: { key: Preset | 'custom'; label: string }[] = [
  { key: 'month', label: 'This month' }, { key: 'last-month', label: 'Last month' },
  { key: '3months', label: 'Last 3 months' }, { key: 'fy', label: 'This FY' },
  { key: 'all', label: 'All time' }, { key: 'custom', label: 'Custom' },
];

type Metric = 'value' | 'orders' | 'qty';
const METRICS: { key: Metric; label: string }[] = [
  { key: 'value', label: 'Value' }, { key: 'orders', label: 'Orders' }, { key: 'qty', label: 'Labels' },
];
const showMetric = (m: Metric, n: number) => (m === 'value' ? rupees(n) : m === 'qty' ? qtyShort(n) : n.toLocaleString('en-US'));

async function getReports(since: string | null): Promise<Fetched> {
  const res  = await fetch(since ? `/api/reports?since=${encodeURIComponent(since)}` : '/api/reports');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Failed to load the report');
  return data;
}

export default function ReportsView() {
  const queryClient = useQueryClient();
  const reloadAll = useRef(false);
  const q = useQuery({
    queryKey: ['reports'],
    queryFn: () => {
      const full = reloadAll.current;
      reloadAll.current = false;
      return syncReports(queryClient.getQueryData<ReportData>(['reports']), full, getReports);
    },
    staleTime: 60_000,
    // Kept for an hour after leaving the page: coming back syncs the changes only.
    gcTime: 60 * 60_000,
    // Changes arrive through useRefetchOnChange; this only rolls "today" over.
    refetchInterval: 30 * 60_000,
  });
  useRefetchOnChange(['job_separations', 'pending_dispatch_notifications'], [['reports']]);

  const [preset, setPreset] = useState<Preset | 'custom'>('month');
  const [custom, setCustom] = useState<Period | null>(null);
  const [unit, setUnit]     = useState<string | null>(null);
  // Customer filter, one value: 'g:UPL' (every UPL plant) or 'p:UPL - 03' (one plant).
  const [who, setWho]       = useState<string | null>(null);
  const group = who?.startsWith('g:') ? who.slice(2) : null;
  const party = who?.startsWith('p:') ? who.slice(2) : null;

  const rows  = q.data?.rows;
  const today = q.data?.today;
  const start = useMemo(() => (rows ? earliestDay(rows) : null), [rows]);
  const period: Period | null = !today ? null
    : preset === 'custom' && custom ? custom
    : presetPeriod(preset === 'custom' ? 'month' : preset, today, start ?? today);

  const a = useMemo(
    () => (rows && period && today ? analyse(rows, period, { unit, group, party }, today, q.data?.cards) : null),
    // period is rebuilt every render; its two days are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, q.data?.cards, period?.from, period?.to, unit, group, party, today],
  );
  const dispatches = q.data?.dispatches;
  const d = useMemo(
    () => (rows && a && today && dispatches ? dispatchOf(rows, dispatches, a.period, a.previous, { unit, group, party }, today) : null),
    [rows, dispatches, a, unit, group, party, today],
  );
  const parties = useMemo(() => (rows ? partyOptions(rows) : []), [rows]);
  const partyName = party ? parties.find((p) => p.key === party)?.party ?? party : group ? `${group} (all plants)` : null;
  // Groups with more than one plant get an "All plants" option above their plants.
  const groupsInList = useMemo(() => {
    const m = new Map<string, typeof parties>();
    for (const p of parties) m.set(p.group, [...(m.get(p.group) ?? []), p]);
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [parties]);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="text-[30px] font-semibold leading-9 tracking-[-0.025em] text-brand-ink">Reports</h1>
          {q.data && (
            <span className="inline-flex flex-wrap items-center gap-x-2 font-mono text-xs text-brand-muted">
              <span className="inline-flex items-center gap-2"
                title={q.data.sync.mismatch
                  ? `The page's totals differ from the database's: ${q.data.sync.mismatch}`
                  : 'Checks Job Separation every 30 seconds, fetches only what changed, and checks the totals against the database'}>
                <span className={cn('h-2 w-2 rounded-full', q.isFetching || q.data.sync.mismatch ? 'bg-amber-400' : 'bg-brand-primary')} aria-hidden="true" />
                {q.isFetching ? 'Syncing…'
                  : q.data.sync.mismatch ? 'Totals differ from the database'
                  : `Live · matches the database · ${timeLabel(q.data.sync.at)}`}
              </span>
              <button type="button" disabled={q.isFetching} onClick={() => { reloadAll.current = true; void q.refetch(); }}
                className="min-h-11 rounded-md px-2 font-sans text-xs font-medium text-brand-primary hover:underline disabled:opacity-50">
                Reload all
              </button>
            </span>
          )}
        </div>
        <p className="mt-1.5 max-w-[72ch] text-sm text-brand-muted">
          The order book from Job Separation, by PO date — what came in, on which unit, from whom, and for what.
        </p>
      </div>

      {/* Controls */}
      <section aria-label="Report filters" className={cn(CARD, 'flex flex-col gap-4 p-4 sm:p-5')}>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <Field label="Period">
            <Segmented
              label="Period"
              value={preset}
              options={PRESETS}
              onChange={(k) => {
                setPreset(k);
                if (k === 'custom' && !custom && period) setCustom(period);
              }}
            />
          </Field>
          {preset === 'custom' && custom && (
            <div className="flex flex-wrap items-end gap-3">
              <Field label="From" htmlFor="rep-from">
                <input id="rep-from" type="date" value={custom.from} max={custom.to}
                  onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })}
                  className={cn('h-11 rounded-[10px] border border-brand-border bg-white px-3 font-mono text-sm text-brand-ink', FOCUS)} />
              </Field>
              <Field label="To" htmlFor="rep-to">
                <input id="rep-to" type="date" value={custom.to} min={custom.from} max={today}
                  onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })}
                  className={cn('h-11 rounded-[10px] border border-brand-border bg-white px-3 font-mono text-sm text-brand-ink', FOCUS)} />
              </Field>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <Field label="Unit">
            <Segmented
              label="Unit"
              value={unit ?? 'all'}
              options={[{ key: 'all', label: 'All units' }, ...UNITS.map((u) => ({ key: u as string, label: unitLabel(u) }))]}
              onChange={(k) => setUnit(k === 'all' ? null : k)}
            />
          </Field>
          <Field label="Party" htmlFor="rep-party">
            <select id="rep-party" value={who ?? ''} onChange={(e) => setWho(e.target.value || null)}
              className={cn('h-11 w-full min-w-[220px] max-w-[360px] rounded-[10px] border border-brand-border bg-white px-3 text-sm text-brand-ink', FOCUS)}>
              <option value="">All parties</option>
              {groupsInList.map(([g, plants]) => plants.length === 1 && plants[0].key === g
                ? <option key={g} value={`p:${g}`}>{plants[0].party}</option>
                : (
                  <optgroup key={g} label={g}>
                    <option value={`g:${g}`}>{g}: all {plants.length} plants</option>
                    {plants.map((p) => <option key={p.key} value={`p:${p.key}`}>{p.party}</option>)}
                  </optgroup>
                ))}
            </select>
          </Field>
          {(unit || who) && (
            <button type="button" onClick={() => { setUnit(null); setWho(null); }}
              className="inline-flex h-11 items-center gap-1.5 rounded-[10px] px-3 text-sm font-medium text-brand-primary hover:bg-brand-surface-hover">
              <X className="h-4 w-4" aria-hidden="true" /> Clear filters
            </button>
          )}
        </div>
        <p className="text-[13px] text-brand-muted" aria-live="polite">
          {a ? <>
            <B>{periodLabel(a.period)}</B>
            {unit && <> · {unitLabel(unit)}</>}{partyName && <> · {partyName}</>}
            {' '}· compared with {periodLabel(a.previous)}
          </> : ' '}
        </p>
      </section>

      {q.error ? (
        <div className={cn(CARD, 'px-5 py-10 text-center text-sm text-brand-danger')} role="alert">
          {(q.error as Error).message}
        </div>
      ) : (
        <Body a={a} d={d} unit={unit} who={who} onUnit={setUnit} onWho={setWho} />
      )}
    </div>
  );
}

function Body({ a, d, unit, who, onUnit, onWho }: {
  a: Analysis | null; d: DispatchView | null; unit: string | null; who: string | null;
  onUnit: (u: string | null) => void; onWho: (w: string | null) => void;
}) {
  const [metric, setMetric] = useState<Metric>('value');
  const [tab, setTab] = useTab();
  const vs = a ? periodLabel(a.previous) : '';
  const t = a?.totals, p = a?.prevTotals;
  const stamp = a ? `${a.period.from}_to_${a.period.to}` : '';

  return (
    <>
      {/* Period at a glance */}
      <section aria-label="Period at a glance" className={cn(CARD, 'flex flex-wrap')}>
        <Kpi label="Order value" loading={!a} value={t ? rupees(t.value) : '—'} delta={t && p && change(t.value, p.value, vs)} />
        <Kpi label="Orders" loading={!a} value={t ? t.orders.toLocaleString('en-US') : '—'} delta={t && p && change(t.orders, p.orders, vs)} />
        <Kpi label="POs" loading={!a} value={t ? t.pos.toLocaleString('en-US') : '—'} delta={t && p && change(t.pos, p.pos, vs)} />
        <Kpi label="Labels ordered" loading={!a} value={t ? qtyShort(t.qty) : '—'} delta={t && p && change(t.qty, p.qty, vs)} />
        <Kpi label="Avg rate per label" loading={!a} value={t ? rate(t.avgRate) : '—'} delta={t && p && rateDelta(t, p, vs)} />
        <Kpi label="Avg order value" loading={!a} value={t?.avgOrder != null ? rupees(t.avgOrder) : '—'} delta={t && p && change(t.avgOrder, p.avgOrder, vs)} />
        <Kpi label="Parties ordering" loading={!a} value={t ? String(t.parties) : '—'}
          delta={a && t && p && (a.cancelled.orders
            ? { text: `${plural(a.cancelled.orders, 'order')} cancelled (${rupees(a.cancelled.value)})`, tone: 'muted' }
            : change(t.parties, p.parties, vs))} />
      </section>

      <Tabs tab={tab} onTab={setTab} a={a} d={d} />

      <div role="tabpanel" id={`rep-panel-${tab}`} aria-labelledby={`rep-tab-${tab}`} className="space-y-6">
        {tab === 'overview' && (a && a.totals.orders === 0 ? (
          <div className={cn(CARD, 'px-5 py-14 text-center')}>
            <p className="text-sm font-medium text-brand-ink">No Job Separation rows in {periodLabel(a.period)} for these filters.</p>
            <p className="mt-1 text-[13px] text-brand-muted">Pick a longer period or clear the filters. Reorders, Pricing and Colour approval look at every order so far, so they still have something to show.</p>
          </div>
        ) : (
          <>
            {a && <Insights a={a} d={d} unit={unit} onTab={setTab} />}
            {a && a.duplicates.length > 0 && <Duplicates list={a.duplicates} />}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]">
              <ChangeBridge a={a} />
              <MonthPace a={a} />
            </div>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]">
              {/* Trend */}
              <section aria-label="Orders over time" className={cn(CARD, 'flex flex-col p-5 sm:p-6')}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-base font-semibold text-brand-ink">
                    {METRICS.find((m) => m.key === metric)!.label} by {a?.trend.grain ?? 'day'}
                  </h2>
                  <Segmented label="Chart shows" value={metric} options={METRICS} onChange={setMetric} small />
                </div>
                {!a ? <Skeleton rows={6} /> : <TrendChart a={a} metric={metric} />}
              </section>

              {/* By unit */}
              <section aria-label="By unit" className={cn(CARD, 'p-5 sm:p-6')}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-base font-semibold text-brand-ink">Which unit the orders land on</h2>
                  <span className="text-xs text-brand-muted">tap a unit to filter</span>
                </div>
                {!a ? <Skeleton rows={3} /> : (
                  <ul className="mt-4 space-y-3">
                    {a.units.map((u) => (
                      <li key={u.key}>
                        <button type="button" disabled={u.key === '—'} onClick={() => onUnit(unit === u.key ? null : u.key)}
                          aria-pressed={unit === u.key}
                          className={cn('w-full rounded-xl border px-4 py-3 text-left transition-colors disabled:cursor-default',
                            unit === u.key ? 'border-brand-primary bg-brand-surface-hover' : 'border-brand-border hover:bg-brand-surface-alt')}>
                          <span className="flex items-baseline justify-between gap-3">
                            <span className="text-sm font-semibold text-brand-ink">{u.label}</span>
                            <span className="font-mono text-sm font-semibold text-brand-ink" title={rupeesFull(u.value)}>{rupees(u.value)}</span>
                          </span>
                          <Bar pct={u.share} strong={u === maxBy(a.units) && u.value > 0} />
                          <span className="mt-1.5 flex flex-wrap justify-between gap-x-3 font-mono text-xs text-brand-muted">
                            <span>{u.share}% of value</span>
                            <span>{plural(u.orders, 'order')} · {qtyShort(u.qty)} labels</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <PartyChanges a={a} onWho={onWho} />
              <section aria-label="Exports" className={cn(CARD, 'p-5 sm:p-6')}>
                <h2 className="text-base font-semibold text-brand-ink">Export to Excel</h2>
                <p className="mt-1 text-[13px] text-brand-muted">CSV of exactly what&apos;s shown: this period, these filters.</p>
                <div className="mt-4 flex flex-col gap-2">
                  <ExportRow title="Every order line" count={a?.lines.length}>
                    <CsvExportButton rows={a?.lines ?? []} columns={LINE_COLUMNS} filename={`orders-${stamp}`} label="CSV" />
                  </ExportRow>
                  <ExportRow title="By party" count={a?.parties.length}>
                    <CsvExportButton rows={a?.parties ?? []} columns={PARTY_COLUMNS} filename={`parties-${stamp}`} label="CSV" />
                  </ExportRow>
                  <ExportRow title="By product" count={a?.products.length}>
                    <CsvExportButton rows={a?.products ?? []} columns={PRODUCT_COLUMNS} filename={`products-${stamp}`} label="CSV" />
                  </ExportRow>
                </div>
              </section>
            </div>
          </>
        ))}

        {tab === 'customers' && (
          <>
            <PartyTable a={a} who={who} onWho={onWho} stamp={stamp} />
            <Segments a={a} onWho={onWho} />
            <Cohorts a={a} />
          </>
        )}

        {tab === 'reorders' && (
          <>
            <Reorders a={a} onWho={onWho} />
            <ForecastCard a={a} />
          </>
        )}

        {tab === 'products' && (
          <>
            <ProductMix a={a} onWho={onWho} />
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]">
              <ProductTable a={a} stamp={stamp} />
              <section aria-label="Order size" className={cn(CARD, 'p-5 sm:p-6')}>
                <h2 className="text-base font-semibold text-brand-ink">How big the orders are</h2>
                <p className="mt-1 text-[13px] text-brand-muted">Order lines by value, and how much of the money each band brings.</p>
                {!a ? <Skeleton rows={5} /> : <SliceList items={a.sizes} />}
              </section>
            </div>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
              <section aria-label="Artwork" className={cn(CARD, 'p-5 sm:p-6')}>
                <h2 className="text-base font-semibold text-brand-ink">Repeat or new artwork</h2>
                <p className="mt-1 text-[13px] text-brand-muted">Read from AW Send To.</p>
                {!a ? <Skeleton rows={3} /> : <SliceList items={a.artwork} />}
              </section>
              <section aria-label="Job cards" className={cn(CARD, 'p-5 sm:p-6')}>
                <h2 className="text-base font-semibold text-brand-ink">Job card status</h2>
                <p className="mt-1 text-[13px] text-brand-muted">Read from JC Status.</p>
                {!a ? <Skeleton rows={3} /> : <SliceList items={a.jobCards} />}
              </section>
              <section aria-label="Day of the week" className={cn(CARD, 'p-5 sm:p-6')}>
                <h2 className="text-base font-semibold text-brand-ink">PO day of the week</h2>
                <p className="mt-1 text-[13px] text-brand-muted">Which days the POs are dated.</p>
                {!a ? <Skeleton rows={7} /> : <SliceList items={a.weekdays} compact />}
              </section>
            </div>
          </>
        )}

        {tab === 'pricing' && (
          <>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]">
              <PriceCurve a={a} />
              <MissingPmCodes a={a} />
            </div>
            <RateChecks a={a} onWho={onWho} />
            <RowChecks a={a} onWho={onWho} />
          </>
        )}

        {tab === 'approval' && <Approvals a={a} onWho={onWho} />}

        {tab === 'dispatch' && <DispatchPanel a={a} d={d} onWho={onWho} />}
      </div>
    </>
  );
}

// ── Tabs ──────────────────────────────────────────────────────

type Tab = 'overview' | 'dispatch' | 'customers' | 'reorders' | 'products' | 'pricing' | 'approval';
const TABS: { key: Tab; label: string; count?: (a: Analysis, d: DispatchView | null) => number }[] = [
  { key: 'overview',  label: 'Overview' },
  // Open lines waiting more than 30 days since their PO.
  { key: 'dispatch',  label: 'Dispatch', count: (_a, d) => d ? d.open.ages.slice(3).reduce((s, b) => s + b.lines, 0) : 0 },
  { key: 'customers', label: 'Customers' },
  { key: 'reorders',  label: 'Reorders & forecast', count: (a) => a.reorders.filter((c) => c.status === 'overdue').length },
  { key: 'products',  label: 'Products' },
  { key: 'pricing',   label: 'Pricing', count: (a) => a.rateChecks.filter((c) => c.atStake > 0).length + a.rowChecks.length },
  { key: 'approval',  label: 'Colour approval', count: (a) => a.approvals?.waiting.length ?? 0 },
];

/** The open tab, kept in the URL hash (#pricing) so a refresh or a shared link opens it. */
function useTab(): [Tab, (t: Tab) => void] {
  const [tab, set] = useState<Tab>('overview');
  useEffect(() => {
    const h = window.location.hash.slice(1);
    if (TABS.some((t) => t.key === h)) set(h as Tab);
  }, []);
  return [tab, (t) => {
    set(t);
    window.history.replaceState(null, '', t === 'overview' ? window.location.pathname + window.location.search : `#${t}`);
  }];
}

/** One row of tabs under the filters; a count marks what needs attention. Arrow keys move between them. */
function Tabs({ tab, onTab, a, d }: { tab: Tab; onTab: (t: Tab) => void; a: Analysis | null; d: DispatchView | null }) {
  const move = (e: React.KeyboardEvent, i: number) => {
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
    if (next == null) return;
    const t = TABS[(next + TABS.length) % TABS.length].key;
    onTab(t);
    document.getElementById(`rep-tab-${t}`)?.focus();
  };
  return (
    <div role="tablist" aria-label="Report sections" className="sticky top-[57px] z-30 -mx-4 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-brand-border bg-brand-bg px-4 sm:mx-0 sm:px-0">
      {TABS.map((t, i) => {
        const n = a && t.count ? t.count(a, d) : 0;
        const on = tab === t.key;
        return (
          <button key={t.key} id={`rep-tab-${t.key}`} type="button" role="tab" aria-selected={on} aria-controls={`rep-panel-${t.key}`}
            tabIndex={on ? 0 : -1} onClick={() => onTab(t.key)} onKeyDown={(e) => move(e, i)}
            className={cn('-mb-px flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(16,85,63,0.18)]',
              on ? 'border-brand-primary text-brand-ink' : 'border-transparent text-brand-muted hover:text-brand-ink')}>
            {t.label}
            {n > 0 && <span className="rounded-full bg-brand-sunken px-1.5 font-mono text-[11px] text-brand-ink">{n}</span>}
          </button>
        );
      })}
    </div>
  );
}

const SeeTab = ({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) => (
  <button type="button" onClick={() => { onTab(tab); document.getElementById(`rep-tab-${tab}`)?.scrollIntoView({ block: 'nearest' }); }}
    className="font-medium text-brand-primary underline-offset-2 hover:underline">
    See {TABS.find((t) => t.key === tab)!.label}
  </button>
);

// ── Sections ──────────────────────────────────────────────────

/** Plain sentences: the few things worth saying out loud about this period. */
function Insights({ a, d, unit, onTab }: { a: Analysis; d: DispatchView | null; unit: string | null; onTab: (t: Tab) => void }) {
  const see = (t: Tab) => <SeeTab tab={t} onTab={onTab} />;
  const out: React.ReactNode[] = [];
  if (d) {
    const late = d.open.ages.slice(3).reduce((s, b) => s + b.value, 0);
    out.push(<>
      <B>{rupees(d.shipped.value)}</B> dispatched in this period ({qtyShort(d.shipped.qty)} labels){d.since > a.period.from ? <>, counting from {dayLabel(d.since)} when every dispatch started being entered</> : ''}.
      {' '}<B>{rupees(d.open.value)}</B> is still to dispatch on {plural(d.open.lines, 'order line')}{late > 0 ? <>, {rupees(late)} of it waiting over 30 days</> : ''}. {see('dispatch')}
    </>);
  }
  const topGroup = a.groups[0];
  if (topGroup && a.groups.length > 1) {
    out.push(<><B>{topGroup.party}</B>{topGroup.plants > 1 ? ` (${topGroup.plants} plants)` : ''} is the biggest customer: {rupees(topGroup.value)}, {topGroup.share}% of the value.</>);
  }
  if (a.groups.length > 3) {
    out.push(<>The three biggest customer groups bring <B>{a.top3GroupShare}%</B> of the value{a.top3GroupShare >= 50 ? ', so losing one would hurt' : ''}.</>);
  }
  const top = a.parties[0];
  if (top && a.parties.length > 1 && top.party !== topGroup?.party) out.push(<>Biggest single plant: <B>{top.party}</B>, {rupees(top.value)} ({top.share}%).</>);
  const overdue = a.reorders.filter((c) => c.status === 'overdue');
  const lapsed  = a.reorders.filter((c) => c.status === 'lapsed').length;
  if (overdue.length || lapsed) {
    out.push(<>
      <B>{plural(overdue.length, 'repeat product')}</B> {overdue.length === 1 ? 'is' : 'are'} overdue for reorder, worth about {rupees(overdue.reduce((s, c) => s + c.typicalValue, 0))} a cycle
      {lapsed ? <>, and {plural(lapsed, 'more look', 'more look')} lost (over two cycles late)</> : ''}. {see('reorders')}
    </>);
  }
  const lead = maxBy(a.units.filter((u) => u.key !== '—'));
  if (!unit && lead && lead.value > 0) out.push(<><B>{lead.label}</B> takes the most work: {lead.share}% of value across {plural(lead.orders, 'order')}.</>);
  const compared = a.parties.filter((p) => p.prevValue > 0);
  const grower = [...compared].sort((x, y) => (y.value - y.prevValue) - (x.value - x.prevValue))[0];
  if (grower && grower.value > grower.prevValue) out.push(<><B>{grower.party}</B> grew the most: {rupees(grower.prevValue)} → {rupees(grower.value)}.</>);
  const faller = [...compared].sort((x, y) => (x.value - x.prevValue) - (y.value - y.prevValue))[0];
  if (faller && faller.value < faller.prevValue) out.push(<><B>{faller.party}</B> dropped the most: {rupees(faller.prevValue)} → {rupees(faller.value)}.</>);
  if (a.newParties.length) out.push(<><B>{plural(a.newParties.length, 'new party', 'new parties')}</B> placed a first order: {a.newParties.slice(0, 3).join(', ')}{a.newParties.length > 3 ? '…' : ''}.</>);
  if (a.quietParties.length) out.push(<><B>{plural(a.quietParties.length, 'party', 'parties')}</B> ordered in the period before but not in this one; the biggest is {a.quietParties[0].party} ({rupees(a.quietParties[0].prevValue)}).</>);
  const highRisk = a.customers.filter((c) => c.risk === 'high');
  if (highRisk.length) {
    out.push(<><B>{plural(highRisk.length, 'customer')}</B> {highRisk.length === 1 ? 'is' : 'are'} at high risk of slipping away, {rupees(highRisk.reduce((s, c) => s + c.value, 0))} of business so far; biggest: {highRisk.slice(0, 2).map((c) => c.party).join(', ')}.</>);
  }
  const under = a.rateChecks.filter((c) => c.atStake > 0);
  if (under.length) {
    out.push(<><B>{plural(under.length, 'product')}</B> {under.length === 1 ? 'was' : 'were'} billed lower than an earlier order at least as big: up to {rupees(under.reduce((s, c) => s + c.atStake, 0))} short if the cut wasn&apos;t agreed. {see('pricing')}</>);
  }
  const [small, bulk] = [a.priceCurve[0], a.priceCurve[a.priceCurve.length - 1]];
  if (small.rate != null && bulk.rate != null) {
    out.push(<>Orders under 1K labels bill <B>{rate(small.rate)}</B> a label; 25K and over, <B>{rate(bulk.rate)}</B>. Small orders are {share(small.orders, a.totals.orders)}% of lines but {share(small.value, a.totals.value)}% of value.</>);
  }
  const held = a.approvals?.waiting.filter((t) => t.hasOrder) ?? [];
  if (held.length) {
    const value = Array.from(new Map(held.map((t) => [t.pm_code, t.poValue])).values()).reduce((s, v) => s + v, 0);
    const stale = held.filter((t) => t.days > 14).length;
    out.push(<><B>{plural(held.length, 'order')}</B> ({rupees(value)}) {held.length === 1 ? 'waits' : 'wait'} on a shade card approval
      {stale ? <>; {stale} for over two weeks, though customers usually approve in a day or two, so check whether Shade Cards was updated</> : ''}. {see('approval')}</>);
  }
  const f = a.forecast, next4 = f.weeks.reduce((s, w) => s + w.repeat + w.fresh, 0);
  if (next4 > 0) {
    const err = a.forecastCheck.error;
    out.push(<>Next four weeks look like about <B>{rupees(next4)}</B> ({rupees(next4 / 4)} a week) against {rupees(f.recentWeekly)} a week over the last four
      {err != null ? <>; tried on {plural(a.forecastCheck.runs.length, 'past four-week stretch', 'past four-week stretches')}, it was off by {a.forecastCheck.runs.length > 1 ? 'a median ' : ''}{err}%</> : ''}. {see('reorders')}</>);
  }
  const y = a.yearAgo;
  if (y && y.totals.value > 0) {
    const pct = Math.round(((a.totals.value - y.totals.value) / y.totals.value) * 100);
    out.push(<>Against the same days last year ({periodLabel(y.period)}): <B>{pct >= 0 ? '▲' : '▼'} {Math.abs(pct)}%</B>, {rupees(y.totals.value)} → {rupees(a.totals.value)}.</>);
  }
  if (a.rowChecks.length) {
    out.push(<><B>{plural(a.rowChecks.length, 'order line')}</B> {a.rowChecks.length === 1 ? 'is' : 'are'} worth a second look (value isn&apos;t labels × rate, or ten times the usual labels), since every figure here counts {a.rowChecks.length === 1 ? 'it' : 'them'}. {see('pricing')}</>);
  }
  const notMade = a.jobCards.find((s) => s.key === 'Not made yet');
  if (notMade?.orders) out.push(<><B>{plural(notMade.orders, 'order')}</B> ({rupees(notMade.value)}) {notMade.orders === 1 ? 'has' : 'have'} no job card yet.</>);
  const big = a.products[0];
  if (big) out.push(<>Biggest product: <B>{big.material}</B>{big.pm_code ? ` (${big.pm_code})` : ''}, {rupees(big.value)} over {plural(big.orders, 'order')}.</>);
  if (!out.length) return null;

  return (
    <section aria-label="What stands out" className={cn(CARD, 'p-5 sm:p-6')}>
      <h2 className="text-base font-semibold text-brand-ink">What stands out</h2>
      <ul className="mt-3 grid gap-x-8 gap-y-2 text-[13px] leading-5 text-brand-muted md:grid-cols-2">
        {out.map((s, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand-primary" aria-hidden="true" />
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
const B = ({ children }: { children: React.ReactNode }) => <strong className="font-semibold text-brand-ink">{children}</strong>;

// ── Dispatch ──────────────────────────────────────────────────

const pendingValue = (s: LineStatus) => s.pending * (s.line.rate ?? 0);
const monthLabel = (m: string) => `${MON[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;

const OPEN_COLUMNS: CsvColumn<LineStatus>[] = [
  { header: 'Sr No',          value: (s) => s.line.sr_no },
  { header: 'PO Date',        value: (s) => csvDate(s.line.day) },
  { header: 'Party',          value: (s) => s.line.party },
  { header: 'PO No',          value: (s) => s.line.po_no },
  { header: 'PM Code',        value: (s) => s.line.pm_code },
  { header: 'Material Name',  value: (s) => s.line.material_name },
  { header: 'Ordered',        value: (s) => s.line.quantity },
  { header: 'Dispatched',     value: (s) => s.shipped },
  { header: 'Pending',        value: (s) => s.pending },
  { header: 'Rate',           value: (s) => s.line.rate },
  { header: 'Pending value',  value: (s) => round2(pendingValue(s)) },
  { header: 'Days since PO',  value: (s) => s.ageDays },
  { header: 'First dispatch', value: (s) => csvDate(s.first) },
];

/**
 * Dispatched in the period, and the open order book as of today. The open
 * book starts at the first dispatch record: older orders have no entries to
 * count against, so calling them pending would be the lie this tab fixes.
 */
function DispatchPanel({ a, d, onWho }: { a: Analysis | null; d: DispatchView | null; onWho: (w: string | null) => void }) {
  if (!a) return <div className={cn(CARD, 'p-5 sm:p-6')}><Skeleton rows={6} /></div>;
  if (!d) {
    return (
      <div className={cn(CARD, 'px-5 py-14 text-center')}>
        <p className="text-sm font-medium text-brand-ink">Dispatch tracking hasn&apos;t started yet.</p>
        <p className="mt-1 text-[13px] text-brand-muted">Dispatched and pending figures start on the day the dispatch team began entering every dispatch.</p>
      </div>
    );
  }
  const vs = periodLabel(a.previous);
  const fill = d.ordered.qty ? Math.round((d.ordered.shippedQty / d.ordered.qty) * 100) : null;

  return (
    <>
      <section aria-label="Dispatch at a glance" className={cn(CARD, 'flex flex-wrap')}>
        <Kpi label="Dispatched value" loading={false} value={rupees(d.shipped.value)} delta={change(d.shipped.value, d.prevShipped.value, vs)} />
        <Kpi label="Labels dispatched" loading={false} value={qtyShort(d.shipped.qty)} delta={change(d.shipped.qty, d.prevShipped.qty, vs)} />
        <Kpi label="Still to dispatch" loading={false} value={rupees(d.open.value)}
          delta={{ text: `${plural(d.open.lines, 'order line')} · ${qtyShort(d.open.qty)} labels, today`, tone: 'muted' }} />
        <Kpi label="This period's orders dispatched" loading={false} value={fill == null ? '—' : `${fill}%`}
          delta={{ text: d.ordered.lines ? `${d.ordered.full} of ${plural(d.ordered.lines, 'line')} complete` : 'no tracked orders in this period', tone: 'muted' }} />
        <Kpi label="PO to first dispatch" loading={false} value={d.leadFirst == null ? '—' : plural(d.leadFirst, 'day')}
          delta={{ text: d.leadDone == null ? 'median, this period' : `median · ${plural(d.leadDone, 'day')} to complete`, tone: 'muted' }} />
      </section>

      <section aria-label="What these figures cover" className={cn(CARD, 'p-5 sm:p-6')}>
        <h2 className="text-base font-semibold text-brand-ink">What these figures cover</h2>
        <ul className="mt-3 grid gap-x-8 gap-y-2 text-[13px] leading-5 text-brand-muted md:grid-cols-2">
          <li>Every dispatch is entered from <B>{dayLabel(d.since, true)}</B>. Orders and entries dated before that aren&apos;t counted{d.untracked.lines ? <>: {plural(d.untracked.lines, 'order line')} ({rupees(d.untracked.value)}) in this period</> : ''}. Older entries stay in History.</li>
          <li>An entry counts from the day of its first team email, against the order line with the same PO and PM code.</li>
          {d.unmatched.entries > 0 && (
            <li><B>{plural(d.unmatched.entries, 'entry', 'entries')}</B> ({qtyShort(d.unmatched.qty)} labels) in this period match no order line, so they&apos;re not in these figures.
              {' '}<Link href="/admin/dispatch-notifications?tab=history" className="font-medium text-brand-primary underline-offset-2 hover:underline">Fix or remove them in History</Link></li>
          )}
          {d.held.lines > 0 && <li>{plural(d.held.lines, 'pending line')} ({rupees(d.held.value)}) with JC status on hold or cancelled are left out of what&apos;s still to dispatch.</li>}
          {d.ordered.lines > 0 && <li>This period&apos;s tracked orders: {d.ordered.full} fully dispatched, {d.ordered.part} part dispatched, {d.ordered.none} not started; {rupees(d.ordered.pendingValue)} of them still to go.</li>}
        </ul>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section aria-label="Still to dispatch, by age" className={cn(CARD, 'p-5 sm:p-6')}>
          <h2 className="text-base font-semibold text-brand-ink">Still to dispatch, by age</h2>
          <p className="mt-1 text-[13px] text-brand-muted">Days since the PO date, as of today.</p>
          <ul className="mt-4 space-y-3">
            {d.open.ages.map((b, i) => (
              <li key={b.label}>
                <span className="flex items-baseline justify-between gap-3">
                  <span className={cn('text-sm', i >= 3 && b.lines ? 'font-semibold text-brand-warning' : 'font-medium text-brand-ink')}>{b.label}</span>
                  <span className="font-mono text-sm font-semibold text-brand-ink" title={rupeesFull(b.value)}>{rupees(b.value)}</span>
                </span>
                <Bar pct={d.open.value ? (b.value / d.open.value) * 100 : 0} strong={i >= 3} />
                <span className="mt-1 block font-mono text-xs text-brand-muted">{plural(b.lines, 'line')}</span>
              </li>
            ))}
          </ul>
        </section>
        <OpenByParty d={d} onWho={onWho} />
      </div>

      <OpenLines d={d} onWho={onWho} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]">
        <section aria-label="Ordered and dispatched by month" className={cn(CARD, 'overflow-hidden')}>
          <div className="px-5 pt-5 sm:px-6">
            <h2 className="text-base font-semibold text-brand-ink">Ordered and dispatched by month</h2>
            <p className="mt-0.5 text-[13px] text-brand-muted">Order value by PO date against dispatched value by dispatch day. Under 100% means the backlog grew that month.</p>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-sm">
              <thead>
                <tr className="text-xs font-medium text-brand-muted">
                  <th className="px-5 py-2.5 text-left sm:px-6">Month</th>
                  <th className="px-3 py-2.5 text-right">Ordered</th>
                  <th className="px-3 py-2.5 text-right">Dispatched</th>
                  <th className="px-5 py-2.5 text-right sm:px-6">Out vs in</th>
                </tr>
              </thead>
              <tbody>
                {d.months.map((m) => {
                  const pct = m.ordered ? Math.round((m.shipped / m.ordered) * 100) : null;
                  return (
                    <tr key={m.month} className="border-t border-brand-line-soft even:bg-brand-surface-alt">
                      <td className="px-5 py-2.5 font-medium text-brand-ink sm:px-6">{monthLabel(m.month)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-brand-ink" title={rupeesFull(m.ordered)}>{rupees(m.ordered)}</td>
                      <td className="px-3 py-2.5 text-right font-mono font-semibold text-brand-ink" title={rupeesFull(m.shipped)}>{rupees(m.shipped)}</td>
                      <td className={cn('px-5 py-2.5 text-right font-mono text-xs sm:px-6', pct == null ? 'text-brand-muted' : pct >= 100 ? 'text-brand-success' : 'text-brand-warning')}>
                        {pct == null ? '—' : `${pct}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
        <OverDispatched d={d} onWho={onWho} />
      </div>
    </>
  );
}

function OpenByParty({ d, onWho }: { d: DispatchView; onWho: (w: string | null) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? d.parties : d.parties.slice(0, 8);
  return (
    <section aria-label="Still to dispatch, by party" className={cn(CARD, 'p-5 sm:p-6')}>
      <h2 className="text-base font-semibold text-brand-ink">Still to dispatch, by party</h2>
      <p className="mt-1 text-[13px] text-brand-muted">Biggest pending value first. Tap a party to see its whole report.</p>
      {d.parties.length === 0 ? <p className="mt-4 text-sm text-brand-muted">Nothing pending. Every tracked order has gone out.</p> : (
        <ul className="mt-3">
          {shown.map((p) => (
            <li key={p.key} className="flex min-h-11 items-center justify-between gap-3 border-t border-brand-line-soft first:border-t-0">
              <button type="button" onClick={() => onWho(`p:${p.key}`)} className="min-h-11 truncate text-left text-sm font-medium text-brand-ink underline-offset-2 hover:underline">{p.party}</button>
              <span className="flex shrink-0 items-baseline gap-3 font-mono text-xs text-brand-muted">
                <span>{plural(p.lines, 'line')}</span>
                <span className={p.oldestDays > 30 ? 'font-semibold text-brand-warning' : ''}>oldest {p.oldestDays} d</span>
                <span className="text-sm font-semibold text-brand-ink" title={rupeesFull(p.value)}>{rupees(p.value)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {d.parties.length > 8 && (
        <button type="button" onClick={() => setAll(!all)} className="mt-1 min-h-11 text-sm font-medium text-brand-primary hover:underline">
          {all ? 'Show top 8' : `Show all ${d.parties.length} parties`}
        </button>
      )}
    </section>
  );
}

function OpenLines({ d, onWho }: { d: DispatchView; onWho: (w: string | null) => void }) {
  const [all, setAll] = useState(false);
  const list = d.openLines;
  const shown = all ? list : list.slice(0, 15);
  const TH = 'px-3 py-2.5 text-right text-xs font-medium text-brand-muted';
  return (
    <section aria-label="Order lines still to dispatch" className={cn(CARD, 'overflow-hidden')}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6">
        <div className="max-w-[72ch]">
          <h2 className="text-base font-semibold text-brand-ink">Order lines still to dispatch</h2>
          <p className="mt-0.5 text-[13px] text-brand-muted">Oldest PO first, as of today. A line leaves this list when its entries add up to the order.</p>
        </div>
        <CsvExportButton rows={list} columns={OPEN_COLUMNS} filename="still-to-dispatch" label="CSV" />
      </div>
      {list.length === 0 ? <p className="px-5 py-10 text-center text-sm text-brand-muted sm:px-6">Nothing pending. Every tracked order has gone out.</p> : (
        <>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="px-5 py-2.5 text-left text-xs font-medium text-brand-muted sm:px-6">Party</th>
                  <th className={cn(TH, 'text-left')}>Product</th>
                  <th className={cn(TH, 'text-left')}>PO</th>
                  <th className={TH}>PO date</th>
                  <th className={TH}>Ordered</th>
                  <th className={TH}>Dispatched</th>
                  <th className={TH}>Pending</th>
                  <th className={TH}>Pending value</th>
                  <th className={cn(TH, 'px-5 sm:px-6')}>Waiting</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.line.id} className="border-t border-brand-line-soft even:bg-brand-surface-alt">
                    <td className="px-5 py-0 sm:px-6">
                      <button type="button" onClick={() => onWho(`p:${partyKey(s.line.party)}`)}
                        className="min-h-11 text-left font-semibold text-brand-ink underline-offset-2 hover:underline">{s.line.party}</button>
                    </td>
                    <td className="max-w-[260px] px-3 py-2">
                      <span className="block truncate text-brand-ink" title={s.line.material_name ?? ''}>{s.line.material_name ?? '—'}</span>
                      <span className="block font-mono text-xs text-brand-muted">{s.line.sr_no ?? ''}{s.line.pm_code ? ` · ${s.line.pm_code}` : ''}</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-brand-ink">{s.line.po_no ?? '—'}</td>
                    <td className="px-3 py-2 text-right font-mono text-brand-muted">{dayLabel(s.line.day)}</td>
                    <td className="px-3 py-2 text-right font-mono text-brand-ink" title={qtyFull(s.line.quantity ?? 0)}>{qtyShort(s.line.quantity ?? 0)}</td>
                    <td className="px-3 py-2 text-right font-mono text-brand-ink" title={qtyFull(s.shipped)}>{s.shipped ? qtyShort(s.shipped) : '—'}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-brand-ink" title={qtyFull(s.pending)}>{qtyShort(s.pending)}</td>
                    <td className="px-3 py-2 text-right font-mono text-brand-ink" title={rupeesFull(pendingValue(s))}>{rupees(pendingValue(s))}</td>
                    <td className={cn('whitespace-nowrap px-5 py-2 text-right font-mono text-xs sm:px-6', s.ageDays > 30 ? 'font-semibold text-brand-warning' : 'text-brand-muted')}>
                      {plural(s.ageDays, 'day')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {list.length > 15 && (
            <div className="border-t border-brand-line-soft px-5 py-1 sm:px-6">
              <button type="button" onClick={() => setAll(!all)} className="min-h-11 text-sm font-medium text-brand-primary hover:underline">
                {all ? 'Show oldest 15' : `Show all ${list.length}`}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function OverDispatched({ d, onWho }: { d: DispatchView; onWho: (w: string | null) => void }) {
  return (
    <section aria-label="More dispatched than ordered" className={cn(CARD, 'p-5 sm:p-6')}>
      <h2 className="text-base font-semibold text-brand-ink">More dispatched than ordered</h2>
      <p className="mt-1 text-[13px] text-brand-muted">Lines whose entries add up past the order: a normal overrun, or an entry typed twice. Check them in History.</p>
      {d.over.length === 0 ? <p className="mt-4 text-sm text-brand-muted">None. No line has more entered than ordered.</p> : (
        <ul className="mt-3">
          {d.over.slice(0, 10).map((s) => (
            <li key={s.line.id} className="flex min-h-11 items-center justify-between gap-3 border-t border-brand-line-soft py-1.5 first:border-t-0">
              <span className="min-w-0">
                <button type="button" onClick={() => onWho(`p:${partyKey(s.line.party)}`)} className="block truncate text-left text-sm font-medium text-brand-ink underline-offset-2 hover:underline">{s.line.party}</button>
                <span className="block truncate font-mono text-xs text-brand-muted">{s.line.po_no}{s.line.pm_code ? ` · ${s.line.pm_code}` : ''}</span>
              </span>
              <span className="shrink-0 text-right font-mono text-xs">
                <span className="block font-semibold text-brand-warning">+{qtyFull(s.over)} ({Math.round((s.over / (s.line.quantity || 1)) * 100)}%)</span>
                <span className="block text-brand-muted">{qtyFull(s.shipped)} of {qtyFull(s.line.quantity ?? 0)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TrendChart({ a, metric }: { a: Analysis; metric: Metric }) {
  const b = a.trend.buckets;
  const max = Math.max(...b.map((x) => x[metric]), 1);
  const peak = b.reduce((m, x) => (x[metric] > m[metric] ? x : m), b[0]);
  const dense = b.length > 14;
  const every = Math.ceil(b.length / (dense ? 8 : 14));   // label every nth bar
  const name = (x: (typeof b)[number]) => (a.trend.grain === 'week' ? `week of ${x.label}` : x.label);

  return (
    <>
      <ul className="mt-6 flex min-h-48 flex-1 items-end gap-[3px] border-b border-brand-border sm:gap-1.5">
        {b.map((x) => (
          <li key={x.key} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
            title={`${name(x)}: ${rupeesFull(x.value)} · ${plural(x.orders, 'order')} · ${qtyFull(x.qty)} labels`}
            aria-label={`${name(x)}: ${showMetric(metric, x[metric])}`}>
            {!dense && <span className="font-mono text-[11px] font-medium text-brand-ink">{x[metric] ? showMetric(metric, x[metric]) : ''}</span>}
            {x[metric] > 0 && (
              <span className={cn('w-full max-w-12 rounded-t', x === peak ? 'bg-brand-primary' : 'bg-green-300')}
                style={{ height: `calc((100% - ${dense ? '0rem' : '1.25rem'}) * ${Math.max(x[metric] / max, 0.02)})` }} />
            )}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-[3px] sm:gap-1.5" aria-hidden="true">
        {b.map((x, i) => (
          <span key={x.key} className="min-w-0 flex-1 whitespace-nowrap text-center font-mono text-[11px] text-brand-muted">
            {i % every === 0 ? x.label : ''}
          </span>
        ))}
      </div>
      {peak[metric] > 0 && (
        <p className="mt-4 text-[13px] text-brand-muted">
          Busiest {a.trend.grain}: <B>{name(peak)}</B> with {showMetric(metric, peak[metric])}
          {metric !== 'orders' && <> from {plural(peak.orders, 'order')}</>}.
        </p>
      )}
    </>
  );
}

type PartySort = 'value' | 'orders' | 'qty' | 'avgRate' | 'change';

function PartyTable({ a, who, onWho, stamp }: { a: Analysis | null; who: string | null; onWho: (w: string | null) => void; stamp: string }) {
  const [sort, setSort] = useState<PartySort>('value');
  const [all, setAll]   = useState(false);
  const [view, setView] = useState<'groups' | 'plants'>('groups');
  const prefix = view === 'groups' ? 'g:' : 'p:';
  const list = useMemo(() => {
    if (!a) return [];
    const key = (p: PartyRow) => (sort === 'change' ? p.value - p.prevValue : sort === 'avgRate' ? p.avgRate ?? 0 : p[sort]);
    return [...(view === 'groups' ? a.groups : a.parties)].sort((x, y) => key(y) - key(x));
  }, [a, sort, view]);
  const shown = all ? list : list.slice(0, 15);

  const Th = ({ k, children }: { k: PartySort; children: React.ReactNode }) => (
    <th aria-sort={sort === k ? 'descending' : undefined} className="px-3 py-0 text-right text-xs font-medium text-brand-muted">
      <button type="button" onClick={() => setSort(k)}
        className={cn('inline-flex min-h-11 items-center gap-1 whitespace-nowrap', sort === k && 'font-semibold text-brand-ink')}>
        {children}{sort === k && <span aria-hidden="true">↓</span>}
      </button>
    </th>
  );
  const TH = 'px-3 py-2.5 text-right text-xs font-medium text-brand-muted';

  return (
    <section aria-label="Parties" className={cn(CARD, 'overflow-hidden')}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 sm:px-6">
        <div>
          <h2 className="text-base font-semibold text-brand-ink">{view === 'groups' ? 'Customer groups' : 'Parties (plants)'}</h2>
          <p className="mt-0.5 text-[13px] text-brand-muted">
            {who ? 'Filtered to one customer. Clear the filter to compare them all.'
              : view === 'groups' ? 'Plants of one customer added together, e.g. every UPL plant as UPL. Tap one to see its whole report.'
              : 'Each plant on its own. Tap one to see its whole report; tap a heading to sort.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Show" value={view} options={[{ key: 'groups', label: 'Groups' }, { key: 'plants', label: 'Plants' }]} onChange={setView} small />
          <CsvExportButton rows={list} columns={PARTY_COLUMNS} filename={`${view === 'groups' ? 'customer-groups' : 'parties'}-${stamp}`} label="CSV" />
        </div>
      </div>
      {!a ? <div className="px-5 pb-5"><Skeleton rows={6} /></div> : (
        <>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="px-5 py-2.5 text-left text-xs font-medium text-brand-muted sm:px-6">{view === 'groups' ? 'Customer' : 'Party'}</th>
                  <Th k="value">Value</Th>
                  <th className={cn(TH, 'text-left')}>Share</th>
                  <Th k="orders">Orders</Th>
                  {view === 'groups' && <th className={TH}>Plants</th>}
                  <th className={TH}>POs</th>
                  <Th k="qty">Labels</Th>
                  <Th k="avgRate">Avg rate</Th>
                  <th className={TH}>Unit 1</th>
                  <th className={TH}>Unit 2</th>
                  <th className={TH}>Units 1 & 2</th>
                  <Th k="change">vs before</Th>
                  <th className={cn(TH, 'px-5 sm:px-6')}>Last PO</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const d = p.value - p.prevValue;
                  return (
                    <tr key={p.key} className="border-t border-brand-line-soft even:bg-brand-surface-alt hover:bg-brand-surface-hover">
                      <td className="px-5 py-0 sm:px-6">
                        <button type="button" onClick={() => onWho(who === prefix + p.key ? null : prefix + p.key)} aria-pressed={who === prefix + p.key}
                          className="min-h-11 text-left font-semibold text-brand-ink underline-offset-2 hover:underline">
                          {p.party}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-semibold text-brand-ink" title={rupeesFull(p.value)}>{rupees(p.value)}</td>
                      <td className="w-36 px-3 py-2">
                        <span className="flex items-center gap-2">
                          <span className="h-2 flex-1 overflow-hidden rounded-full bg-brand-sunken">
                            <span className="block h-full rounded-full bg-brand-primary" style={{ width: `${Math.max(p.share, 1)}%` }} />
                          </span>
                          <span className="w-11 text-right font-mono text-xs text-brand-muted">{p.share}%</span>
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-brand-ink">{p.orders}</td>
                      {view === 'groups' && <td className="px-3 py-2 text-right font-mono text-brand-ink">{p.plants}</td>}
                      <td className="px-3 py-2 text-right font-mono text-brand-ink">{p.pos}</td>
                      <td className="px-3 py-2 text-right font-mono text-brand-ink" title={qtyFull(p.qty)}>{qtyShort(p.qty)}</td>
                      <td className="px-3 py-2 text-right font-mono text-brand-ink">{rate(p.avgRate)}</td>
                      {UNITS.map((u) => (
                        <td key={u} className="px-3 py-2 text-right font-mono text-brand-muted">{p.byUnit[u] ? rupees(p.byUnit[u]) : '—'}</td>
                      ))}
                      <td className={cn('whitespace-nowrap px-3 py-2 text-right font-mono text-xs', !p.prevValue ? 'text-brand-muted' : d >= 0 ? 'text-brand-success' : 'text-brand-warning')}
                        title={`Period before: ${rupeesFull(p.prevValue)}`}>
                        {!p.prevValue ? 'none before' : `${d >= 0 ? '▲' : '▼'} ${rupees(Math.abs(d))}`}
                      </td>
                      <td className="px-5 py-2 text-right font-mono text-brand-muted sm:px-6">{dayLabel(p.lastDay)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {list.length > 15 && (
            <div className="border-t border-brand-line-soft px-5 py-1 sm:px-6">
              <button type="button" onClick={() => setAll(!all)} className="min-h-11 text-sm font-medium text-brand-primary hover:underline">
                {all ? 'Show top 15' : `Show all ${list.length} ${view === 'groups' ? 'groups' : 'parties'}`}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ProductTable({ a, stamp }: { a: Analysis | null; stamp: string }) {
  const [all, setAll] = useState(false);
  const list = a?.products ?? [];
  const shown = all ? list : list.slice(0, 10);
  const TH = 'px-3 py-2.5 text-right text-xs font-medium text-brand-muted';
  return (
    <section aria-label="Products" className={cn(CARD, 'overflow-hidden')}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 sm:px-6">
        <div>
          <h2 className="text-base font-semibold text-brand-ink">Top products</h2>
          <p className="mt-0.5 text-[13px] text-brand-muted">By PM code, biggest order value first.</p>
        </div>
        <CsvExportButton rows={list} columns={PRODUCT_COLUMNS} filename={`products-${stamp}`} label="CSV" />
      </div>
      {!a ? <div className="px-5 pb-5"><Skeleton rows={6} /></div> : (
        <>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="px-5 py-2.5 text-left text-xs font-medium text-brand-muted sm:px-6">Product</th>
                  <th className={TH}>Value</th>
                  <th className={TH}>Orders</th>
                  <th className={TH}>Labels</th>
                  <th className={TH}>Parties</th>
                  <th className={cn(TH, 'px-5 sm:px-6')}>Avg rate</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.key} className="border-t border-brand-line-soft even:bg-brand-surface-alt">
                    <td className="max-w-[320px] px-5 py-2.5 sm:px-6">
                      <span className="block truncate font-medium text-brand-ink" title={p.material}>{p.material}</span>
                      {p.pm_code && <span className="block font-mono text-xs text-brand-muted">{p.pm_code}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold text-brand-ink" title={rupeesFull(p.value)}>{rupees(p.value)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-brand-ink">{p.orders}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-brand-ink" title={qtyFull(p.qty)}>{qtyShort(p.qty)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-brand-ink">{p.parties}</td>
                    <td className="px-5 py-2.5 text-right font-mono text-brand-ink sm:px-6">{rate(p.avgRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {list.length > 10 && (
            <div className="border-t border-brand-line-soft px-5 py-1 sm:px-6">
              <button type="button" onClick={() => setAll(!all)} className="min-h-11 text-sm font-medium text-brand-primary hover:underline">
                {all ? 'Show top 10' : `Show all ${list.length} products`}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function PartyChanges({ a, onWho }: { a: Analysis | null; onWho: (w: string | null) => void }) {
  return (
    <section aria-label="New and quiet parties" className={cn(CARD, 'grid gap-6 p-5 sm:grid-cols-2 sm:p-6')}>
      <div>
        <h2 className="text-base font-semibold text-brand-ink">New parties</h2>
        <p className="mt-1 text-[13px] text-brand-muted">First order ever in this period.</p>
        {!a ? <Skeleton rows={3} /> : a.newParties.length === 0 ? (
          <p className="mt-4 text-sm text-brand-muted">None this period.</p>
        ) : (
          <ul className="mt-3">
            {a.newParties.map((p) => (
              <li key={p}>
                <button type="button" onClick={() => onWho(`p:${partyKey(p)}`)} className="min-h-11 text-left text-sm font-medium text-brand-ink hover:underline">{p}</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h2 className="text-base font-semibold text-brand-ink">Gone quiet</h2>
        <p className="mt-1 text-[13px] text-brand-muted">Ordered in the period before, nothing in this one.</p>
        {!a ? <Skeleton rows={3} /> : a.quietParties.length === 0 ? (
          <p className="mt-4 text-sm text-brand-muted">None. Everyone ordered again.</p>
        ) : (
          <ul className="mt-3">
            {a.quietParties.map((p) => (
              <li key={p.party} className="flex min-h-11 items-center justify-between gap-3 border-t border-brand-line-soft first:border-t-0">
                <span className="truncate text-sm font-medium text-brand-ink">{p.party}</span>
                <span className="font-mono text-xs text-brand-muted" title="Value in the period before">{rupees(p.prevValue)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

const REORDER_COLUMNS: CsvColumn<Cycle>[] = [
  { header: 'Party',                 value: (c) => c.party },
  { header: 'PM Code',               value: (c) => c.pm_code },
  { header: 'Material Name',         value: (c) => c.material },
  { header: 'Orders seen',           value: (c) => c.orders },
  { header: 'Usual gap (days)',      value: (c) => c.cycleDays },
  { header: 'Last ordered',          value: (c) => csvDate(c.lastDay) },
  { header: 'Expected by',           value: (c) => csvDate(c.dueDay) },
  { header: 'Days late',             value: (c) => c.lateDays },
  { header: 'Status',                value: (c) => c.status },
  { header: 'Typical labels',        value: (c) => c.typicalQty },
  { header: 'Typical order value',   value: (c) => round2(c.typicalValue) },
];

type ReorderTab = 'overdue' | 'due' | 'parties';
const lateFirst = (x: Cycle, y: Cycle) =>
  (x.status === 'lapsed' ? 1 : 0) - (y.status === 'lapsed' ? 1 : 0) || y.typicalValue - x.typicalValue;

/**
 * What should be coming back. From every order so far (not the period):
 * products a party buys again and again, when the next order is due, and
 * plants that have gone longer than usual without ordering anything.
 */
function Reorders({ a, onWho }: { a: Analysis | null; onWho: (w: string | null) => void }) {
  const [tab, setTab] = useState<ReorderTab>('overdue');
  const [all, setAll] = useState(false);
  const lists = useMemo(() => (a ? {
    overdue: a.reorders.filter((c) => c.status === 'overdue' || c.status === 'lapsed').sort(lateFirst),
    due:     a.reorders.filter((c) => c.status === 'due').sort((x, y) => x.dueDay.localeCompare(y.dueDay)),
    parties: a.partyCycles.filter((c) => c.status === 'overdue' || c.status === 'lapsed').sort(lateFirst),
  } : null), [a]);
  const list = lists?.[tab] ?? [];
  const shown = all ? list : list.slice(0, 12);
  const TH = 'px-3 py-2.5 text-right text-xs font-medium text-brand-muted';

  return (
    <section aria-label="Reorders due" className={cn(CARD, 'overflow-hidden')}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6">
        <div className="max-w-[72ch]">
          <h2 className="text-base font-semibold text-brand-ink">Reorders due</h2>
          <p className="mt-0.5 text-[13px] text-brand-muted">
            Products a party orders again and again, and when the next order should come, from its usual gap between orders.
            Based on every order so far, not just this period; the gaps get more reliable as months of history add up.
          </p>
        </div>
        <CsvExportButton rows={list} columns={REORDER_COLUMNS} filename={`reorders-${tab}`} label="CSV" />
      </div>
      <div className="px-5 pt-4 sm:px-6">
        <Segmented
          label="Reorder list"
          value={tab}
          onChange={(k) => { setTab(k); setAll(false); }}
          options={[
            { key: 'overdue', label: `Overdue${lists ? ` (${lists.overdue.length})` : ''}` },
            { key: 'due',     label: `Due in 14 days${lists ? ` (${lists.due.length})` : ''}` },
            { key: 'parties', label: `Plants gone quiet${lists ? ` (${lists.parties.length})` : ''}` },
          ]}
        />
      </div>
      {!a ? <div className="px-5 pb-5"><Skeleton rows={5} /></div> : list.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-brand-muted sm:px-6">
          {tab === 'due' ? 'Nothing due in the next 14 days.' : 'Nothing overdue. Every repeat customer is ordering on time.'}
        </p>
      ) : (
        <>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="px-5 py-2.5 text-left text-xs font-medium text-brand-muted sm:px-6">Party</th>
                  {tab !== 'parties' && <th className={cn(TH, 'text-left')}>Product</th>}
                  <th className={TH}>Usually every</th>
                  <th className={TH}>Orders seen</th>
                  <th className={TH}>Last ordered</th>
                  <th className={TH}>Expected by</th>
                  <th className={TH}>Status</th>
                  <th className={cn(TH, 'px-5 sm:px-6')}>Typical order</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.key} className="border-t border-brand-line-soft even:bg-brand-surface-alt">
                    <td className="px-5 py-0 sm:px-6">
                      <button type="button" onClick={() => onWho(`p:${partyKey(c.party)}`)}
                        className="min-h-11 text-left font-semibold text-brand-ink underline-offset-2 hover:underline">{c.party}</button>
                    </td>
                    {tab !== 'parties' && (
                      <td className="max-w-[300px] px-3 py-2">
                        <span className="block truncate text-brand-ink" title={c.material ?? ''}>{c.material ?? '—'}</span>
                        {c.pm_code && <span className="block font-mono text-xs text-brand-muted">{c.pm_code}</span>}
                      </td>
                    )}
                    <td className="px-3 py-2 text-right font-mono text-brand-ink">{plural(c.cycleDays, 'day')}</td>
                    <td className="px-3 py-2 text-right font-mono text-brand-ink">{c.orders}</td>
                    <td className="px-3 py-2 text-right font-mono text-brand-muted">{dayLabel(c.lastDay)}</td>
                    <td className="px-3 py-2 text-right font-mono text-brand-ink">{dayLabel(c.dueDay)}</td>
                    <td className={cn('whitespace-nowrap px-3 py-2 text-right font-mono text-xs',
                      c.status === 'overdue' ? 'font-semibold text-brand-warning' : 'text-brand-muted')}>
                      {c.status === 'lapsed' ? `probably lost · ${c.lateDays} d late`
                        : c.lateDays > 0 ? `${c.lateDays} d late`
                        : c.lateDays === 0 ? 'due today' : `due in ${-c.lateDays} d`}
                    </td>
                    <td className="px-5 py-2 text-right sm:px-6">
                      <span className="block font-mono font-semibold text-brand-ink" title={rupeesFull(c.typicalValue)}>{rupees(c.typicalValue)}</span>
                      <span className="block font-mono text-xs text-brand-muted">{qtyShort(c.typicalQty)} labels</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {list.length > 12 && (
            <div className="border-t border-brand-line-soft px-5 py-1 sm:px-6">
              <button type="button" onClick={() => setAll(!all)} className="min-h-11 text-sm font-medium text-brand-primary hover:underline">
                {all ? 'Show first 12' : `Show all ${list.length}`}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

const CUSTOMER_COLUMNS: CsvColumn<CustomerRow>[] = [
  { header: 'Party',                 value: (c) => c.party },
  { header: 'Group',                 value: (c) => c.group },
  { header: 'Segment',               value: (c) => c.segment },
  { header: 'Risk',                  value: (c) => c.risk },
  { header: 'Why',                   value: (c) => c.why },
  { header: 'First order',           value: (c) => csvDate(c.firstDay) },
  { header: 'Last order',            value: (c) => csvDate(c.lastDay) },
  { header: 'Days since last order', value: (c) => c.daysSince },
  { header: 'Orders',                value: (c) => c.orders },
  { header: 'Usual gap (days)',      value: (c) => c.cycleDays },
  { header: 'Value so far',          value: (c) => round2(c.value) },
  { header: 'Last 30 days',          value: (c) => round2(c.last30) },
  { header: '30 days before',        value: (c) => round2(c.prev30) },
  { header: 'R',                     value: (c) => c.score.r },
  { header: 'F',                     value: (c) => c.score.f },
  { header: 'M',                     value: (c) => c.score.m },
];

/**
 * Every plant scored on recency, frequency and money (RFM), put in a
 * segment with what to do about it, and flagged when it's slipping away.
 * Tiles filter the table to one segment.
 */
function Segments({ a, onWho }: { a: Analysis | null; onWho: (w: string | null) => void }) {
  const [seg, setSeg]   = useState<Segment | null>(null);
  const [risk, setRisk] = useState<'all' | 'risk'>('all');
  const [all, setAll]   = useState(false);
  const customers = a?.customers ?? [];
  const total = customers.reduce((s, c) => s + c.value, 0);
  const list = customers.filter((c) => (!seg || c.segment === seg) && (risk === 'all' || c.risk));
  const shown = all ? list : list.slice(0, 15);
  const TH = 'px-3 py-2.5 text-right text-xs font-medium text-brand-muted';

  return (
    <section aria-label="Customer segments" className={cn(CARD, 'overflow-hidden')}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6">
        <div className="max-w-[72ch]">
          <h2 className="text-base font-semibold text-brand-ink">Customer segments</h2>
          <p className="mt-0.5 text-[13px] text-brand-muted">
            Each plant scored 1 to 3 on how recently (ordered within 14 days = 3, within 45 = 2), how often and how much it orders (R · F · M), from every order so far.
            Tap a segment to list its customers.
          </p>
        </div>
        <CsvExportButton rows={list} columns={CUSTOMER_COLUMNS} filename={`customers-${seg ?? 'all'}`} label="CSV" />
      </div>

      {!a ? <div className="px-5 pb-5 sm:px-6"><Skeleton rows={4} /></div> : (
        <>
          <ul className="grid gap-2 px-5 pt-4 sm:grid-cols-2 sm:px-6 xl:grid-cols-3">
            {SEGMENTS.map((k) => {
              const members = customers.filter((c) => c.segment === k);
              const value = members.reduce((s, c) => s + c.value, 0);
              return (
                <li key={k}>
                  <button type="button" aria-pressed={seg === k} onClick={() => { setSeg(seg === k ? null : k); setAll(false); }}
                    className={cn('flex h-full w-full flex-col gap-1 rounded-xl border px-4 py-3 text-left transition-colors',
                      seg === k ? 'border-brand-primary bg-brand-surface-hover shadow-[inset_0_-3px_0_#10553F]' : 'border-brand-border hover:bg-brand-surface-alt')}>
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-semibold text-brand-ink">{k}</span>
                      <span className="font-mono text-xs text-brand-muted">
                        {plural(members.length, 'customer')} · {total ? Math.round((value / total) * 100) : 0}% of value
                      </span>
                    </span>
                    <span className="text-[13px] leading-5 text-brand-muted">{SEGMENT_ACTIONS[k]}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap items-center gap-3 px-5 pt-4 sm:px-6">
            <Segmented label="Show" value={risk} onChange={(k) => { setRisk(k); setAll(false); }} small
              options={[{ key: 'all', label: 'All customers' }, { key: 'risk', label: `Slipping away (${customers.filter((c) => c.risk).length})` }]} />
            {seg && (
              <button type="button" onClick={() => setSeg(null)} className="inline-flex min-h-9 items-center gap-1 rounded-[9px] px-2 text-sm font-medium text-brand-primary hover:bg-brand-surface-hover">
                <X className="h-4 w-4" aria-hidden="true" /> {seg} only
              </button>
            )}
          </div>

          {list.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-brand-muted sm:px-6">No customers here.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[1000px] border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="px-5 py-2.5 text-left text-xs font-medium text-brand-muted sm:px-6">Party</th>
                    <th className={cn(TH, 'text-left')}>Segment</th>
                    <th className={cn(TH, 'text-left')}>Watch</th>
                    <th className={TH}>Last order</th>
                    <th className={TH}>Orders</th>
                    <th className={TH}>Usual gap</th>
                    <th className={TH}>Value so far</th>
                    <th className={TH}>Last 30 days</th>
                    <th className={cn(TH, 'px-5 sm:px-6')} title="Recency · Frequency · Money, 1 to 3, 3 best">R · F · M</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((c) => {
                    const d = c.last30 - c.prev30;
                    return (
                      <tr key={c.key} className="border-t border-brand-line-soft even:bg-brand-surface-alt">
                        <td className="px-5 py-0 sm:px-6">
                          <button type="button" onClick={() => onWho(`p:${c.key}`)}
                            className="min-h-11 text-left font-semibold text-brand-ink underline-offset-2 hover:underline">{c.party}</button>
                        </td>
                        <td className="px-3 py-2 text-brand-ink">{c.segment}</td>
                        <td className="max-w-[260px] px-3 py-2">
                          {c.risk ? (
                            <>
                              <span className={cn('block text-xs font-semibold', c.risk === 'high' ? 'text-brand-danger' : 'text-brand-warning')}>
                                {c.risk === 'high' ? 'High risk' : 'Watch'}
                              </span>
                              <span className="block text-xs text-brand-muted">{c.why}</span>
                            </>
                          ) : <span className="text-xs text-brand-muted">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span className="block font-mono text-brand-ink">{c.daysSince === 0 ? 'today' : `${c.daysSince} d ago`}</span>
                          <span className="block font-mono text-xs text-brand-muted">{dayLabel(c.lastDay)}</span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-brand-ink">{c.orders}</td>
                        <td className="px-3 py-2 text-right font-mono text-brand-muted">{c.cycleDays ? `${c.cycleDays} d` : '—'}</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold text-brand-ink" title={rupeesFull(c.value)}>{rupees(c.value)}</td>
                        <td className="px-3 py-2 text-right" title={`30 days before: ${rupeesFull(c.prev30)}`}>
                          <span className="block font-mono text-brand-ink">{rupees(c.last30)}</span>
                          {(c.last30 || c.prev30) ? (
                            <span className={cn('block font-mono text-xs', d >= 0 ? 'text-brand-success' : 'text-brand-warning')}>
                              {d >= 0 ? '▲' : '▼'} {rupees(Math.abs(d))}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-5 py-2 text-right font-mono text-brand-muted sm:px-6">{c.score.r} · {c.score.f} · {c.score.m}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {list.length > 15 && (
            <div className="border-t border-brand-line-soft px-5 py-1 sm:px-6">
              <button type="button" onClick={() => setAll(!all)} className="min-h-11 text-sm font-medium text-brand-primary hover:underline">
                {all ? 'Show first 15' : `Show all ${list.length}`}
              </button>
            </div>
          )}
          <div className="h-2" />
        </>
      )}
    </section>
  );
}

const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** Rate per label by labels per order, this period: what a short run costs against a long one. */
function PriceCurve({ a }: { a: Analysis | null }) {
  const max = Math.max(...(a?.priceCurve ?? []).map((b) => b.rate ?? 0), 0.01);
  return (
    <section aria-label="Rate by order size" className={cn(CARD, 'p-5 sm:p-6')}>
      <h2 className="text-base font-semibold text-brand-ink">Rate per label by order size</h2>
      <p className="mt-1 text-[13px] text-brand-muted">
        Average rate a label (value ÷ labels) for order lines of each size, this period. Short runs carry the same setup, so they cost more a label.
      </p>
      {!a ? <Skeleton rows={6} /> : (
        <ul className="mt-4 space-y-3">
          {a.priceCurve.map((b) => (
            <li key={b.label} title={`${b.label} labels: ${plural(b.orders, 'order')} · ${qtyFull(b.qty)} labels · ${rupeesFull(b.value)}`}>
              <span className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] text-brand-ink">{b.label} labels</span>
                <span className="font-mono text-[13px] font-semibold text-brand-ink">{b.rate == null ? '—' : `${rate(b.rate)} a label`}</span>
              </span>
              <Bar pct={((b.rate ?? 0) / max) * 100} strong={b.rate === max} />
              <span className="mt-1 flex justify-between gap-3 font-mono text-xs text-brand-muted">
                <span>{plural(b.orders, 'order')}</span>
                <span>{rupees(b.value)} · {share(b.value, a.totals.value)}% of value</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Rows whose PM code is blank or a placeholder: their rates and reorders can't be followed. */
function MissingPmCodes({ a }: { a: Analysis | null }) {
  const rows = a?.noPmCode ?? [];
  return (
    <section aria-label="Orders without a PM code" className={cn(CARD, 'p-5 sm:p-6')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-base font-semibold text-brand-ink">Orders without a PM code</h2>
        <CsvExportButton rows={rows} columns={LINE_COLUMNS} filename="orders-without-pm-code" label="CSV" />
      </div>
      <p className="mt-1 text-[13px] text-brand-muted">
        Blank, 0, 00, - or NA. Without a PM code a product can&apos;t be followed from order to order, so these stay out of the rate
        check and reorders. All orders so far.
      </p>
      {!a ? <Skeleton rows={4} /> : rows.length === 0 ? (
        <p className="mt-6 text-sm text-brand-muted">Every order has a PM code.</p>
      ) : (
        <>
          <p className="mt-4 font-mono text-2xl font-semibold text-brand-ink">{rows.length.toLocaleString('en-US')}</p>
          <p className="font-mono text-xs text-brand-muted">orders, worth {rupees(rows.reduce((s, r) => s + (r.order_value ?? 0), 0))}</p>
          <ul className="mt-4 space-y-1.5 text-[13px]">
            {byCount(rows.map((r) => r.party.trim())).slice(0, 5).map(([party, n]) => (
              <li key={party} className="flex justify-between gap-3">
                <span className="truncate text-brand-ink">{party}</span>
                <span className="font-mono text-brand-muted">{plural(n, 'order')}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
const byCount = (xs: string[]) => Array.from(xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())).sort((x, y) => y[1] - x[1]);

const rateHistory = (c: RateCheck) => c.lines.map((l) => `${l.day}: ${l.qty} @ ${l.rate}`).join('; ');
const RATE_COLUMNS: CsvColumn<RateCheck>[] = [
  { header: 'Party',              value: (c) => c.party },
  { header: 'PM Code',            value: (c) => c.pm_code },
  { header: 'Material Name',      value: (c) => c.material },
  { header: 'Orders',             value: (c) => c.lines.length },
  { header: 'Lowest rate',        value: (c) => c.low },
  { header: 'Highest rate',       value: (c) => c.high },
  { header: 'Latest rate',        value: (c) => c.latest },
  { header: 'Billed lower on',    value: (c) => (c.undercut ? csvDate(c.undercut.line.day) : null) },
  { header: 'Rate then',          value: (c) => c.undercut?.line.rate ?? null },
  { header: 'Earlier rate',       value: (c) => c.undercut?.was.rate ?? null },
  { header: 'Possible shortfall', value: (c) => round2(c.atStake) },
  { header: 'History (date: labels @ rate)', value: rateHistory },
];

/**
 * Products billed at more than one rate, from every order so far. A higher
 * rate on a smaller order is the size curve at work; an order billed lower
 * than an earlier one at least as big is worth a look.
 */
function RateChecks({ a, onWho }: { a: Analysis | null; onWho: (w: string | null) => void }) {
  const [tab, setTab] = useState<'lower' | 'all'>('lower');
  const [all, setAll] = useState(false);
  const lists = useMemo(() => (a ? { lower: a.rateChecks.filter((c) => c.atStake > 0), all: a.rateChecks } : null), [a]);
  const list = lists?.[tab] ?? [];
  const shown = all ? list : list.slice(0, 12);
  const TH = 'px-3 py-2.5 text-right text-xs font-medium text-brand-muted';

  return (
    <section aria-label="Rate check" className={cn(CARD, 'overflow-hidden')}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6">
        <div className="max-w-[72ch]">
          <h2 className="text-base font-semibold text-brand-ink">Rate check</h2>
          <p className="mt-0.5 text-[13px] text-brand-muted">
            Products a party was billed at more than one rate. A higher rate on a smaller order is normal; an order billed
            lower than an earlier or same-day one at least as big may be a missed rate or a typing slip. Shortfall = those labels × the
            difference. All orders so far.
          </p>
        </div>
        <CsvExportButton rows={list} columns={RATE_COLUMNS} filename={`rate-check-${tab}`} label="CSV" />
      </div>
      <div className="px-5 pt-4 sm:px-6">
        <Segmented
          label="Rate list"
          value={tab}
          onChange={(k) => { setTab(k); setAll(false); }}
          options={[
            { key: 'lower', label: `Billed lower than before${lists ? ` (${lists.lower.length})` : ''}` },
            { key: 'all',   label: `Every product with more than one rate${lists ? ` (${lists.all.length})` : ''}` },
          ]}
        />
      </div>
      {!a ? <div className="px-5 pb-5"><Skeleton rows={5} /></div> : list.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-brand-muted sm:px-6">
          {tab === 'lower' ? 'No order was billed lower than an earlier one at least as big.' : 'Every product has one rate.'}
        </p>
      ) : (
        <>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[960px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="px-5 py-2.5 text-left text-xs font-medium text-brand-muted sm:px-6">Party</th>
                  <th className={cn(TH, 'text-left')}>Product</th>
                  <th className={cn(TH, 'text-left')}>Orders: labels @ rate</th>
                  <th className={TH}>Lowest – highest</th>
                  <th className={cn(TH, 'px-5 sm:px-6')}>Possible shortfall</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.key} className="border-t border-brand-line-soft align-top even:bg-brand-surface-alt">
                    <td className="px-5 py-0 sm:px-6">
                      <button type="button" onClick={() => onWho(`p:${partyKey(c.party)}`)}
                        className="min-h-11 text-left font-semibold text-brand-ink underline-offset-2 hover:underline">{c.party}</button>
                    </td>
                    <td className="max-w-[260px] px-3 py-2">
                      <span className="block truncate text-brand-ink" title={c.material ?? ''}>{c.material ?? '—'}</span>
                      <span className="block font-mono text-xs text-brand-muted">{c.pm_code}</span>
                    </td>
                    <td className="px-3 py-2">
                      <ul className="space-y-0.5 font-mono text-xs">
                        {c.lines.slice(-5).map((l, i) => {
                          const cut = c.undercut?.line === l, was = c.undercut?.was === l;
                          return (
                            <li key={i} className={cn(cut ? 'font-semibold text-brand-warning' : was ? 'text-brand-ink' : 'text-brand-muted')}>
                              {dayLabel(l.day)} · {qtyFull(l.qty)} @ {rate(l.rate)}
                              {cut && ' ← lower'}{was && ' ← billed higher'}
                            </li>
                          );
                        })}
                        {c.lines.length > 5 && <li className="text-brand-muted">and {plural(c.lines.length - 5, 'earlier order')}</li>}
                      </ul>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-brand-ink">
                      {rate(c.low)} – {rate(c.high)}
                      {c.high >= 3 * c.low && <span className="block text-xs text-brand-muted">{(c.high / c.low).toFixed(1)}× apart</span>}
                    </td>
                    <td className="px-5 py-2 text-right font-mono font-semibold text-brand-ink sm:px-6" title={c.atStake ? rupeesFull(c.atStake) : ''}>
                      {c.atStake ? rupees(c.atStake) : <span className="font-normal text-brand-muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {list.length > 12 && (
            <div className="border-t border-brand-line-soft px-5 py-1 sm:px-6">
              <button type="button" onClick={() => setAll(!all)} className="min-h-11 text-sm font-medium text-brand-primary hover:underline">
                {all ? 'Show first 12' : `Show all ${list.length}`}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

const CARD_COLUMNS: CsvColumn<CardTrack>[] = [
  { header: 'Party',            value: (t) => t.customer },
  { header: 'Product',          value: (t) => t.product },
  { header: 'PM Code',          value: (t) => t.pm_code },
  { header: 'Status',           value: (t) => t.status },
  { header: 'Prepared',         value: (t) => csvDate(t.prepared) },
  { header: 'Sent to party',    value: (t) => csvDate(t.sent) },
  { header: 'Approved',         value: (t) => csvDate(t.approved) },
  { header: 'Days',             value: (t) => t.days },
  { header: 'PO date',          value: (t) => csvDate(t.poDay) },
  { header: 'Order value',      value: (t) => round2(t.poValue) },
];

const days = (n: number | null) => (n == null ? '—' : plural(Math.round(n * 10) / 10, 'day'));

/**
 * Shade cards matched to orders by PM code. The PO comes first here, so
 * this is the time colour approval adds to an order, the orders held on
 * the customer, and approved cards that never turned into an order.
 */
function Approvals({ a, onWho }: { a: Analysis | null; onWho: (w: string | null) => void }) {
  const [tab, setTab] = useState<'waiting' | 'notSent' | 'noOrder' | 'parties'>('waiting');
  const [all, setAll] = useState(false);
  const ap = a?.approvals;
  const count = !ap ? 0 : tab === 'parties' ? ap.byParty.length : ap[tab].length;
  const cards = !ap || tab === 'parties' ? [] : ap[tab];
  const cut = <T,>(xs: T[]) => (all ? xs : xs.slice(0, 12));
  const TH = 'px-3 py-2.5 text-right text-xs font-medium text-brand-muted';
  const party = (name: string) => (
    <button type="button" onClick={() => onWho(`p:${partyKey(name)}`)}
      className="min-h-11 text-left font-semibold text-brand-ink underline-offset-2 hover:underline">{name}</button>
  );

  return (
    <section aria-label="Colour approval" className={cn(CARD, 'overflow-hidden')}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6">
        <div className="max-w-[72ch]">
          <h2 className="text-base font-semibold text-brand-ink">Colour approval</h2>
          <p className="mt-0.5 text-[13px] text-brand-muted">
            Shade cards matched to Job Separation by PM code{ap ? `, since ${dayLabel(ap.since, true)} when the order book starts` : ''}.
            The PO comes first and the card follows, so this is how long approval adds before printing, and what waits on the customer.
          </p>
        </div>
        {tab !== 'parties' && <CsvExportButton rows={cards} columns={CARD_COLUMNS} filename={`shade-cards-${tab}`} label="CSV" />}
      </div>
      {!ap ? <div className="px-5 pb-5"><Skeleton rows={5} /></div> : (
        <>
          <div className="mt-4 flex flex-wrap border-y border-brand-line-soft">
            {([['poToCard', 'PO to card made'], ['cardToSent', 'Card made to sent'], ['sentToApproved', 'Sent to approved (the customer)'], ['poToApproved', 'PO to approved']] as const).map(([k, label]) => (
              <Kpi key={k} loading={false} label={label} value={days(ap.steps[k].days)}
                delta={{ text: `median of ${plural(ap.steps[k].n, 'card')} with both dates`, tone: 'muted' }} />
            ))}
          </div>
          <div className="px-5 pt-4 sm:px-6">
            <Segmented
              label="Shade card list"
              value={tab}
              onChange={(k) => { setTab(k); setAll(false); }}
              options={[
                { key: 'waiting', label: `Waiting on the customer (${ap.waiting.length})` },
                { key: 'notSent', label: `Made, not sent (${ap.notSent.length})` },
                { key: 'noOrder', label: `Approved, no order yet (${ap.noOrder.length})` },
                { key: 'parties', label: `By party (${ap.byParty.length})` },
              ]}
            />
          </div>
          {count === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-brand-muted sm:px-6">
              {tab === 'waiting' ? 'No shade card is waiting for approval.' : tab === 'notSent' ? 'Every pending card has been sent.' : tab === 'noOrder' ? 'Every approved card has an order.' : 'No shade cards in this view.'}
            </p>
          ) : (
            <>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[820px] border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="px-5 py-2.5 text-left text-xs font-medium text-brand-muted sm:px-6">Party</th>
                      {tab === 'parties' ? (
                        <>
                          <th className={TH}>Shade cards</th>
                          <th className={TH}>Waiting</th>
                          <th className={TH}>No order</th>
                          <th className={cn(TH, 'px-5 sm:px-6')}>Sent to approved</th>
                        </>
                      ) : (
                        <>
                          <th className={cn(TH, 'text-left')}>Product</th>
                          <th className={TH}>{tab === 'notSent' ? 'Made' : 'Sent'}</th>
                          <th className={TH}>{tab === 'noOrder' ? 'Approved' : 'Waiting'}</th>
                          <th className={cn(TH, 'px-5 sm:px-6')}>{tab === 'noOrder' ? 'Since approval' : 'Order held'}</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {tab === 'parties' ? cut(ap.byParty).map((p) => (
                      <tr key={p.customer} className="border-t border-brand-line-soft even:bg-brand-surface-alt">
                        <td className="px-5 py-0 sm:px-6">{party(p.customer)}</td>
                        <td className="px-3 py-2 text-right font-mono text-brand-ink">{p.cards}</td>
                        <td className={cn('px-3 py-2 text-right font-mono', p.pending ? 'font-semibold text-brand-warning' : 'text-brand-muted')}>{p.pending}</td>
                        <td className="px-3 py-2 text-right font-mono text-brand-ink">{p.noOrder}</td>
                        <td className="px-5 py-2 text-right font-mono text-brand-ink sm:px-6">{days(p.sentToApproved)}</td>
                      </tr>
                    )) : cut(cards).map((t) => (
                      <tr key={t.id} className="border-t border-brand-line-soft even:bg-brand-surface-alt">
                        <td className="px-5 py-0 sm:px-6">{party(t.customer)}</td>
                        <td className="max-w-[320px] px-3 py-2">
                          <span className="block truncate text-brand-ink" title={t.product ?? ''}>{t.product ?? '—'}</span>
                          {t.pm_code && <span className="block font-mono text-xs text-brand-muted">{t.pm_code}</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-brand-muted">
                          {dayLabel(t.start)}
                        </td>
                        {tab !== 'noOrder' ? (
                          <>
                            <td className={cn('px-3 py-2 text-right font-mono', t.days > 7 ? 'font-semibold text-brand-warning' : 'text-brand-ink')}>{plural(t.days, 'day')}</td>
                            <td className="px-5 py-2 text-right sm:px-6">
                              {t.hasOrder ? (
                                <>
                                  <span className="block font-mono font-semibold text-brand-ink" title={rupeesFull(t.poValue)}>{rupees(t.poValue)}</span>
                                  <span className="block font-mono text-xs text-brand-muted">PO {dayLabel(t.poDay!)}</span>
                                </>
                              ) : <span className="font-mono text-xs text-brand-muted">no order yet</span>}
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-3 py-2 text-right font-mono text-brand-ink">{t.approved ? dayLabel(t.approved) : '—'}</td>
                            <td className="px-5 py-2 text-right font-mono text-brand-ink sm:px-6">{days(t.sinceApproved)}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {count > 12 && (
                <div className="border-t border-brand-line-soft px-5 py-1 sm:px-6">
                  <button type="button" onClick={() => setAll(!all)} className="min-h-11 text-sm font-medium text-brand-primary hover:underline">
                    {all ? 'Show first 12' : `Show all ${count}`}
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

const shortDay = (d: string) => `${+d.slice(8, 10)} ${MON[+d.slice(5, 7) - 1]}`;
const weekLabel = (w: { from: string; to: string }) =>
  w.from.slice(5, 7) === w.to.slice(5, 7) ? `${+w.from.slice(8, 10)} – ${shortDay(w.to)}` : `${shortDay(w.from)} – ${shortDay(w.to)}`;

/** The next four weeks: reorders due on their usual gap, plus new products at their recent pace. */
function ForecastCard({ a }: { a: Analysis | null }) {
  const f = a?.forecast;
  const max = Math.max(...(f?.weeks ?? []).map((w) => w.repeat + w.fresh), f?.recentWeekly ?? 0, 1);
  return (
    <section aria-label="Next four weeks" className={cn(CARD, 'p-5 sm:p-6')}>
      <h2 className="text-base font-semibold text-brand-ink">Next four weeks: a rough forecast</h2>
      <p className="mt-1 max-w-[72ch] text-[13px] text-brand-muted">
        Each repeat product&apos;s typical order lands on its usual gap (overdue ones count this week), plus products not seen before, at
        their pace over the last eight weeks. Trust the four-week total more than any single week: one big one-off order can swing a week 40% either way.
      </p>
      {!f ? <Skeleton rows={4} /> : (
        <>
          <p className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-[28px] font-semibold leading-none text-brand-ink">{rupees(f.weeks.reduce((s, w) => s + w.repeat + w.fresh, 0))}</span>
            <span className="text-[13px] text-brand-muted">
              over the next four weeks, against {rupees(f.recentWeekly * 4)} in the last four
            </span>
          </p>
          <ul className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {f.weeks.map((w, i) => {
              const total = w.repeat + w.fresh;
              return (
                <li key={w.from} className="rounded-xl border border-brand-border p-4"
                  title={`${weekLabel(w)}: ${rupeesFull(total)} — reorders ${rupeesFull(w.repeat)}, products not seen before ${rupeesFull(w.fresh)}`}>
                  <span className="block text-xs font-medium text-brand-muted">{i === 0 ? 'This week' : `Week ${i + 1}`} · {weekLabel(w)}</span>
                  <span className="mt-1 block font-mono text-lg font-semibold text-brand-ink">{rupees(total)}</span>
                  <Bar pct={(total / max) * 100} strong={i === 0} />
                  <span className="mt-2 block font-mono text-xs text-brand-muted">{rupees(w.repeat)} from {plural(w.orders, 'reorder')}</span>
                  <span className="block font-mono text-xs text-brand-muted">{rupees(w.fresh)} products not seen before</span>
                </li>
              );
            })}
          </ul>
          <ForecastScore check={a!.forecastCheck} />
        </>
      )}
    </section>
  );
}

/** The forecast re-run as of past days, against what came in: how far to trust it, from this data, kept current. */
function ForecastScore({ check }: { check: Analysis['forecastCheck'] }) {
  if (!check.runs.length) {
    return (
      <p className="mt-5 border-t border-brand-line-soft pt-4 text-[13px] text-brand-muted">
        Once there are six weeks of orders before a past cut-off, the forecast scores itself here against what actually came in.
      </p>
    );
  }
  return (
    <div className="mt-5 border-t border-brand-line-soft pt-4">
      <h3 className="text-sm font-semibold text-brand-ink">
        How it did on past weeks{check.error != null && <>: {check.runs.length === 1 ? 'off by' : 'a median miss of'} <span className="font-mono">{check.error}%</span>
          {check.runs.length === 1 && <span className="font-normal text-brand-muted"> (one run so far; a run is added each week)</span>}</>}
      </h3>
      <p className="mt-0.5 max-w-[72ch] text-[13px] text-brand-muted">
        Re-run as of earlier days with only the orders known then, against what was dated in the four weeks after. Re-scored every
        time the page loads, so it tracks how good the forecast is as the order book grows.
      </p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {check.runs.map((r) => {
          const miss = r.actual > 0 ? Math.round(((r.predicted - r.actual) / r.actual) * 100) : null;
          return (
            <li key={r.asOf} className="rounded-xl border border-brand-border px-4 py-3">
              <span className="block text-xs font-medium text-brand-muted">From {dayLabel(r.asOf)}</span>
              <span className="mt-1 block font-mono text-[13px] text-brand-ink">said {rupees(r.predicted)} · came {rupees(r.actual)}</span>
              <span className="block font-mono text-xs text-brand-muted">
                {miss == null ? 'nothing came in' : miss === 0 ? 'spot on' : `${miss > 0 ? 'over' : 'under'} by ${Math.abs(miss)}%`}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const STAGE_NOTES: Record<ProductStage, string> = {
  'New':       'First seen in the last 30 days.',
  'Reordered': 'Ordered more than once and still coming.',
  'Only once': 'One order, over 30 days ago. Ask if it’s still needed.',
  'Stopped':   'Used to repeat, now over two usual gaps late.',
};

const LIFE_COLUMNS: CsvColumn<ProductLife>[] = [
  { header: 'Party',         value: (p) => p.party },
  { header: 'PM Code',       value: (p) => p.pm_code },
  { header: 'Material Name', value: (p) => p.material },
  { header: 'Stage',         value: (p) => p.stage },
  { header: 'First ordered', value: (p) => csvDate(p.firstDay) },
  { header: 'Last ordered',  value: (p) => csvDate(p.lastDay) },
  { header: 'Orders',        value: (p) => p.orders },
  { header: 'Order value',   value: (p) => round2(p.value) },
];

/** Repeat business against new products, by month, and where every product stands today. */
function ProductMix({ a, onWho }: { a: Analysis | null; onWho: (w: string | null) => void }) {
  const [stage, setStage] = useState<ProductStage>('Only once');
  const [all, setAll] = useState(false);
  const life = a?.lifecycle;
  const list = useMemo(() => life?.products.filter((p) => p.stage === stage) ?? [], [life, stage]);
  const shown = all ? list : list.slice(0, 8);
  const TH = 'px-3 py-2.5 text-right text-xs font-medium text-brand-muted';

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_3fr]">
      <section aria-label="Repeat and new by month" className={cn(CARD, 'p-5 sm:p-6')}>
        <h2 className="text-base font-semibold text-brand-ink">Repeat business and new products</h2>
        <p className="mt-1 text-[13px] text-brand-muted">
          Each month&apos;s value: products ordered before, and products seen for the first time. The data starts on{' '}
          {life ? dayLabel(life.months[0]?.month + '-01', true) : '…'}, so a product ordered every few months still shows as new on its first
          visit; the repeat share will rise as history builds up. Products already running in the first two weeks count as repeat.
        </p>
        {!life ? <Skeleton rows={4} /> : (
          <ul className="mt-4 space-y-3.5">
            {life.months.map((m) => {
              const total = m.repeat + m.fresh;
              const pct = total ? Math.round((m.repeat / total) * 100) : 0;
              return (
                <li key={m.month} title={`${m.label}: repeat ${rupeesFull(m.repeat)}, new products ${rupeesFull(m.fresh)}`}>
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px] text-brand-ink">{m.label}</span>
                    <span className="font-mono text-[13px] font-medium text-brand-ink">{rupees(total)}</span>
                  </span>
                  <Bar pct={pct} strong />
                  <span className="mt-1 flex flex-wrap justify-between gap-x-3 font-mono text-xs text-brand-muted">
                    <span>{pct}% repeat · {rupees(m.repeat)}</span>
                    <span>{rupees(m.fresh)} from {plural(m.freshProducts, 'product')} seen first</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-label="Where products stand" className={cn(CARD, 'overflow-hidden')}>
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6">
          <div>
            <h2 className="text-base font-semibold text-brand-ink">Where each product stands</h2>
            <p className="mt-0.5 text-[13px] text-brand-muted">Party + PM code, from every order so far. Tap a stage to list it.</p>
          </div>
          <CsvExportButton rows={life?.products ?? []} columns={LIFE_COLUMNS} filename="products-by-stage" label="CSV" />
        </div>
        {!life ? <div className="px-5 pb-5"><Skeleton rows={5} /></div> : (
          <>
            <div className="grid gap-2 px-5 pt-4 sm:grid-cols-2 sm:px-6">
              {PRODUCT_STAGES.map((st) => {
                const ps = life.products.filter((p) => p.stage === st);
                return (
                  <button key={st} type="button" onClick={() => { setStage(st); setAll(false); }} aria-pressed={stage === st}
                    className={cn('min-h-11 rounded-xl border px-3 py-2 text-left transition-colors',
                      stage === st ? 'border-brand-primary bg-brand-surface-hover' : 'border-brand-border hover:bg-brand-surface-alt')}>
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-brand-ink">{st}</span>
                      <span className="font-mono text-xs text-brand-muted">{plural(ps.length, 'product')} · {rupees(ps.reduce((s, p) => s + p.value, 0))}</span>
                    </span>
                    <span className="mt-0.5 block text-xs text-brand-muted">{STAGE_NOTES[st]}</span>
                  </button>
                );
              })}
            </div>
            {list.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-brand-muted sm:px-6">No products here.</p>
            ) : (
              <>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse text-sm">
                    <thead>
                      <tr>
                        <th className="px-5 py-2.5 text-left text-xs font-medium text-brand-muted sm:px-6">Party</th>
                        <th className={cn(TH, 'text-left')}>Product</th>
                        <th className={TH}>Orders</th>
                        <th className={TH}>Last ordered</th>
                        <th className={cn(TH, 'px-5 sm:px-6')}>Value so far</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((p) => (
                        <tr key={p.key} className="border-t border-brand-line-soft even:bg-brand-surface-alt">
                          <td className="px-5 py-0 sm:px-6">
                            <button type="button" onClick={() => onWho(`p:${partyKey(p.party)}`)}
                              className="min-h-11 text-left font-semibold text-brand-ink underline-offset-2 hover:underline">{p.party}</button>
                          </td>
                          <td className="max-w-[260px] px-3 py-2">
                            <span className="block truncate text-brand-ink" title={p.material ?? ''}>{p.material ?? '—'}</span>
                            <span className="block font-mono text-xs text-brand-muted">{p.pm_code}</span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-brand-ink">{p.orders}</td>
                          <td className="px-3 py-2 text-right font-mono text-brand-muted">{dayLabel(p.lastDay)}</td>
                          <td className="px-5 py-2 text-right font-mono font-semibold text-brand-ink sm:px-6" title={rupeesFull(p.value)}>{rupees(p.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {list.length > 8 && (
                  <div className="border-t border-brand-line-soft px-5 py-1 sm:px-6">
                    <button type="button" onClick={() => setAll(!all)} className="min-h-11 text-sm font-medium text-brand-primary hover:underline">
                      {all ? 'Show first 8' : `Show all ${list.length}`}
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}

const BRIDGE: Record<BridgeKey, { label: string; one: string; many: string }> = {
  newCustomers:    { label: 'New customers',                   one: 'plant',   many: 'plants' },
  returned:        { label: 'Back after a gap',                one: 'plant',   many: 'plants' },
  lost:            { label: 'Didn’t order this time',          one: 'plant',   many: 'plants' },
  addedProducts:   { label: 'Other products, same plants',     one: 'product', many: 'products' },
  droppedProducts: { label: 'Products not ordered again',      one: 'product', many: 'products' },
  volume:          { label: 'More or fewer labels',            one: 'product', many: 'products' },
  price:           { label: 'Rate per label',                  one: 'product', many: 'products' },
};

/**
 * Last period's value to this one as a waterfall: each part starts where the
 * one before it ended, and the parts add up to the change exactly.
 */
function ChangeBridge({ a }: { a: Analysis | null }) {
  const b = a?.bridge;
  const steps = b?.steps.filter((x) => Math.round(x.value) !== 0) ?? [];
  let run = b?.from ?? 0;
  const bars = steps.map((x) => {
    const lo = Math.min(run, run + x.value), hi = Math.max(run, run + x.value);
    run += x.value;
    return { ...x, lo, hi };
  });
  const max = Math.max(b?.from ?? 0, b?.to ?? 0, ...bars.map((x) => x.hi), 1);
  // The headline nets the parts that mostly offset: in one fortnight a plant
  // orders some PM codes, in the next others, so added vs dropped products
  // is largely timing. Their net is the real product-mix effect.
  const net = (keys: BridgeKey[]) => (b?.steps ?? []).filter((x) => keys.includes(x.key)).reduce((t, x) => t + x.value, 0);
  const drivers = ([
    ['plants new, back or gone', net(['newCustomers', 'returned', 'lost'])],
    ['different products', net(['addedProducts', 'droppedProducts'])],
    ['labels on the same products', net(['volume'])],
    ['rate per label', net(['price'])],
  ] as [string, number][]).filter(([, v]) => Math.round(v) !== 0).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
  const diff = b ? b.to - b.from : 0;
  const Row = ({ label, sub, value, lo, hi, tone }: { label: string; sub?: string; value: string; lo: number; hi: number; tone: 'total' | 'up' | 'down' }) => (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3">
      <span className="min-w-0 text-[13px] text-brand-ink">{label}{sub && <span className="block font-mono text-xs text-brand-muted sm:ml-1.5 sm:inline">{sub}</span>}</span>
      <span className={cn('font-mono text-[13px] font-semibold', tone === 'down' ? 'text-brand-warning' : tone === 'up' ? 'text-brand-success' : 'text-brand-ink')}>{value}</span>
      <span className="relative col-span-2 mt-1.5 block h-2.5 rounded-full bg-brand-sunken">
        <span className={cn('absolute inset-y-0 rounded-full', tone === 'total' ? 'bg-brand-primary' : tone === 'up' ? 'bg-green-300' : 'bg-amber-300')}
          style={{ left: `${(lo / max) * 100}%`, width: `${Math.max(((hi - lo) / max) * 100, 0.8)}%` }} />
      </span>
    </li>
  );
  return (
    <section aria-label="What changed" className={cn(CARD, 'p-5 sm:p-6')}>
      <h2 className="text-base font-semibold text-brand-ink">What changed{a ? ` since ${periodLabel(a.previous)}` : ''}</h2>
      <p className="mt-1 max-w-[72ch] text-[13px] text-brand-muted">
        The change in order value, split into where it came from. The parts add up exactly. Rate per label compares the same
        products, so it also moves with run size: a shorter run bills more a label.
      </p>
      {!a || !b ? <Skeleton rows={7} /> : !b.from && !b.to ? (
        <p className="mt-6 text-sm text-brand-muted">No orders in either period to compare.</p>
      ) : (
        <>
          <p className="mt-4 text-[13px] text-brand-muted">
            <B>{diff >= 0 ? '▲' : '▼'} {rupees(Math.abs(diff))}</B>{b.from > 0 && <> ({Math.round((diff / b.from) * 100)}%)</>}
            {drivers.length > 0 && <>. Net, by cause: {drivers.map(([label, v], i) => (
              <span key={label}>{i > 0 && ', '}{label} <B>{v > 0 ? '+' : '−'}{rupees(Math.abs(v))}</B></span>
            ))}</>}.
          </p>
          <ul className="mt-4 space-y-3">
            <Row label={periodLabel(a.previous)} value={rupees(b.from)} lo={0} hi={b.from} tone="total" />
            {bars.map((x) => (
              <Row key={x.key} label={BRIDGE[x.key].label} sub={plural(x.count, BRIDGE[x.key].one, BRIDGE[x.key].many)}
                value={`${x.value > 0 ? '+' : '−'}${rupees(Math.abs(x.value))}`} lo={x.lo} hi={x.hi} tone={x.value > 0 ? 'up' : 'down'} />
            ))}
            <Row label={periodLabel(a.period)} value={rupees(b.to)} lo={0} hi={b.to} tone="total" />
          </ul>
        </>
      )}
    </section>
  );
}

/** The current month as it fills in: so far, where it's heading, and last month beside it. Ignores the period, follows the filters. */
function MonthPace({ a }: { a: Analysis | null }) {
  const p = a?.pace;
  const name = p ? MON[+p.month.slice(5, 7) - 1] : '';
  const last = p ? MON[(+p.month.slice(5, 7) + 10) % 12] : '';
  const max = p ? Math.max(p.projected, p.lastMonth, 1) : 1;
  const vsToDate = p && p.lastMonthToDate > 0 ? Math.round(((p.soFar - p.lastMonthToDate) / p.lastMonthToDate) * 100) : null;
  const line = (label: string, value: number, strong?: boolean) => (
    <li title={`${label}: ${rupeesFull(value)}`}>
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-brand-ink">{label}</span>
        <span className="font-mono text-[13px] font-semibold text-brand-ink">{rupees(value)}</span>
      </span>
      <Bar pct={(value / max) * 100} strong={strong} />
    </li>
  );
  return (
    <section aria-label="This month so far" className={cn(CARD, 'p-5 sm:p-6')}>
      <h2 className="text-base font-semibold text-brand-ink">{p ? `${name} so far` : 'This month so far'}</h2>
      <p className="mt-1 text-[13px] text-brand-muted">Whatever period is picked. Follows the unit and party filters.</p>
      {!p ? <Skeleton rows={4} /> : (
        <>
          <p className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-[28px] font-semibold leading-none text-brand-ink">{rupees(p.soFar)}</span>
            <span className="text-[13px] text-brand-muted">
              {p.day} of {p.daysIn} days
              {vsToDate != null && <>, <span className={vsToDate >= 0 ? 'text-brand-success' : 'text-brand-warning'}>{vsToDate >= 0 ? '▲' : '▼'} {Math.abs(vsToDate)}%</span> on {last} by this day</>}
            </span>
          </p>
          <ul className="mt-5 space-y-3.5">
            {line(`${name}: on course for`, p.projected, true)}
            {line(`${last}, the whole month`, p.lastMonth)}
            {line(`${last} by day ${p.day}`, p.lastMonthToDate)}
          </ul>
          <p className="mt-4 text-xs text-brand-muted">
            On course for = what&apos;s in so far, plus the four-week forecast for the days left (reorders due and the pace of new products).
          </p>
        </>
      )}
    </section>
  );
}

/**
 * Plants by the month of their first order, and the share of each group
 * ordering again in every month since: whether newer customers stay.
 */
function Cohorts({ a }: { a: Analysis | null }) {
  const list = a?.cohorts ?? [];
  const width = Math.max(...list.map((c) => c.active.length), 1);
  const TH = 'px-3 py-2.5 text-right text-xs font-medium text-brand-muted';
  return (
    <section aria-label="Do customers come back" className={cn(CARD, 'overflow-hidden')}>
      <div className="max-w-[72ch] px-5 pt-5 sm:px-6">
        <h2 className="text-base font-semibold text-brand-ink">Do customers come back?</h2>
        <p className="mt-0.5 text-[13px] text-brand-muted">
          Plants grouped by the month of their first order. Each cell is the share of that group ordering in a later month. Read down a
          column to see whether newer customers stay better than older ones. A column fills in as each month passes.
        </p>
      </div>
      {!a ? <div className="px-5 pb-5"><Skeleton rows={4} /></div> : width < 2 ? (
        <p className="px-5 py-10 text-center text-sm text-brand-muted sm:px-6">Needs a second month of orders. It fills in on its own.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr>
                <th className="px-5 py-2.5 text-left text-xs font-medium text-brand-muted sm:px-6">First ordered</th>
                <th className={TH}>Plants</th>
                <th className={TH}>Value so far</th>
                {Array.from({ length: width - 1 }, (_, i) => <th key={i} className={TH}>{i === 0 ? '1 month on' : `${i + 1} months`}</th>)}
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.month} className="border-t border-brand-line-soft">
                  <td className="px-5 py-2.5 sm:px-6">
                    <span className="block font-medium text-brand-ink">{MON[+c.month.slice(5, 7) - 1]} {c.month.slice(0, 4)}</span>
                    {c.onBooks && <span className="block text-xs text-brand-muted">already customers when the data starts</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-brand-ink">{c.customers}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-brand-ink" title={rupeesFull(c.value)}>{rupees(c.value)}</td>
                  {Array.from({ length: width - 1 }, (_, i) => {
                    const pct = c.active[i + 1];
                    const partial = c.partial && i + 1 === c.active.length - 1;
                    return (
                      <td key={i} className="px-3 py-2.5 text-right font-mono"
                        style={pct != null ? { backgroundColor: `rgba(16,85,63,${(pct / 100) * 0.22})` } : undefined}
                        title={pct == null ? 'Not reached yet' : `${pct}% of the ${MON[+c.month.slice(5, 7) - 1]} plants ordered ${i + 1} month${i ? 's' : ''} on${partial ? ' (this month, so far)' : ''}`}>
                        {pct == null ? '' : <span className={partial ? 'text-brand-muted' : 'text-brand-ink'}>{Math.round(pct)}%{partial ? '…' : ''}</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-5 py-3 text-xs text-brand-muted sm:px-6">… is this month, still filling in.</p>
        </div>
      )}
    </section>
  );
}

const CHECK_COLUMNS: CsvColumn<RowCheck>[] = [
  { header: 'What looks off', value: (c) => c.issue },
  ...LINE_COLUMNS.map((col) => ({ header: col.header, value: (c: RowCheck) => col.value(c.row) })),
];

/** Order lines that look mistyped: every figure on this page counts them, so they're worth fixing on Job Separation. */
function RowChecks({ a, onWho }: { a: Analysis | null; onWho: (w: string | null) => void }) {
  const [all, setAll] = useState(false);
  const list = a?.rowChecks ?? [];
  const shown = all ? list : list.slice(0, 12);
  return (
    <section aria-label="Order lines to check" className={cn(CARD, 'overflow-hidden')}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6">
        <div className="max-w-[72ch]">
          <h2 className="text-base font-semibold text-brand-ink">Order lines to check</h2>
          <p className="mt-0.5 text-[13px] text-brand-muted">
            Lines whose value isn&apos;t labels × rate, with no value, or with ten times the labels the product usually runs. Often a
            typo (an extra zero), and every total here counts it. Small top-ups aren&apos;t flagged. All orders so far.
          </p>
        </div>
        <CsvExportButton rows={list} columns={CHECK_COLUMNS} filename="order-lines-to-check" label="CSV" />
      </div>
      {!a ? <div className="px-5 pb-5"><Skeleton rows={3} /></div> : list.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-brand-muted sm:px-6">Nothing looks off. Every line&apos;s value is labels × rate, and no run is far bigger than its product&apos;s usual.</p>
      ) : (
        <>
          <ul className="mt-3">
            {shown.map((c, i) => (
              <li key={`${c.row.id}-${i}`} className="grid gap-x-4 gap-y-0.5 border-t border-brand-line-soft px-5 py-2.5 sm:grid-cols-[110px_minmax(0,1fr)_minmax(0,1.4fr)] sm:px-6">
                <span className="font-mono text-xs text-brand-muted">{dayLabel(c.row.day)}{c.row.sr_no && <> · {c.row.sr_no}</>}</span>
                <span className="min-w-0">
                  <button type="button" onClick={() => onWho(`p:${partyKey(c.row.party)}`)}
                    className="block max-w-full truncate text-left text-sm font-semibold text-brand-ink underline-offset-2 hover:underline">{c.row.party}</button>
                  <span className="block truncate text-xs text-brand-muted">{c.row.material_name ?? '—'}{c.row.pm_code && <> · <span className="font-mono">{c.row.pm_code}</span></>}</span>
                </span>
                <span className="text-[13px] text-brand-warning">{c.issue}</span>
              </li>
            ))}
          </ul>
          {list.length > 12 && (
            <div className="border-t border-brand-line-soft px-5 py-1 sm:px-6">
              <button type="button" onClick={() => setAll(!all)} className="min-h-11 text-sm font-medium text-brand-primary hover:underline">
                {all ? 'Show first 12' : `Show all ${list.length}`}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Names one or two letters apart: one customer's figures split in two until the spelling is fixed. */
function Duplicates({ list }: { list: Analysis['duplicates'] }) {
  return (
    <section aria-label="Possible duplicate party names" className={cn(CARD, 'border-amber-200 bg-amber-50/60 p-5 sm:p-6')}>
      <h2 className="text-base font-semibold text-brand-ink">Same party, two spellings?</h2>
      <p className="mt-1 text-[13px] text-brand-muted">
        These names look like one customer typed two ways, so its figures are split across both. Correct the spelling on
        Job Separation and they&apos;ll count as one.
      </p>
      <ul className="mt-3 space-y-1.5 text-sm text-brand-ink">
        {list.map((d) => (
          <li key={`${d.a}|${d.b}`}>
            <B>{d.a}</B> <span className="font-mono text-xs text-brand-muted">({plural(d.aOrders, 'order')})</span>
            {' '}and <B>{d.b}</B> <span className="font-mono text-xs text-brand-muted">({plural(d.bOrders, 'order')})</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Small pieces ──────────────────────────────────────────────

const maxBy = (xs: Slice[]) => xs.reduce<Slice | undefined>((m, x) => (!m || x.value > m.value ? x : m), undefined);

function Bar({ pct, strong }: { pct: number; strong?: boolean }) {
  return (
    <span className="mt-2 block h-2.5 overflow-hidden rounded-full bg-brand-sunken">
      <span className={cn('block h-full rounded-full', strong ? 'bg-brand-primary' : 'bg-green-300')} style={{ width: `${pct > 0 ? Math.max(pct, 1.5) : 0}%` }} />
    </span>
  );
}

/** One row per slice: name, value, a share bar, and its share and order count underneath. */
function SliceList({ items, compact }: { items: Slice[]; compact?: boolean }) {
  const top = maxBy(items);
  return (
    <ul className={cn('mt-4', compact ? 'space-y-2' : 'space-y-3.5')}>
      {items.map((s) => (
        <li key={s.key} title={`${s.label}: ${rupeesFull(s.value)} · ${plural(s.orders, 'order')} · ${qtyFull(s.qty)} labels`}>
          <span className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] text-brand-ink">{s.label}</span>
            <span className="font-mono text-[13px] font-medium text-brand-ink">
              {compact && <span className="mr-2 font-normal text-brand-muted">{plural(s.orders, 'order')} ·</span>}
              {rupees(s.value)}
            </span>
          </span>
          <Bar pct={s.share} strong={s === top && s.value > 0} />
          {!compact && (
            <span className="mt-1 flex justify-between gap-3 font-mono text-xs text-brand-muted">
              <span>{s.share}% of value</span>
              <span>{plural(s.orders, 'order')}</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Segmented<K extends string>({ label, value, options, onChange, small }: {
  label: string; value: K; options: { key: K; label: string }[]; onChange: (k: K) => void; small?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full flex-wrap gap-1 rounded-[12px] bg-brand-sunken p-1">
      {options.map((o) => (
        <button key={o.key} type="button" role="radio" aria-checked={value === o.key} onClick={() => onChange(o.key)}
          className={cn('rounded-[9px] px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(16,85,63,0.18)]',
            small ? 'min-h-9' : 'min-h-11',
            value === o.key ? 'bg-white text-brand-ink shadow-[0_1px_3px_rgba(12,42,32,0.12)]' : 'text-brand-muted hover:text-brand-ink')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 max-w-full flex-col gap-1.5">
      {htmlFor
        ? <label htmlFor={htmlFor} className="text-xs font-medium text-brand-muted">{label}</label>
        : <span className="text-xs font-medium text-brand-muted" aria-hidden="true">{label}</span>}
      {children}
    </div>
  );
}

function ExportRow({ title, count, children }: { title: string; count: number | undefined; children: React.ReactNode }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-brand-border px-4 py-2">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-brand-ink">{title}</span>
        <span className="block font-mono text-xs text-brand-muted">{count == null ? '…' : plural(count, 'row')}</span>
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
