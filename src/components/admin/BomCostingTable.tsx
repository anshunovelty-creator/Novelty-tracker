'use client';
// src/components/admin/BomCostingTable.tsx
// Bill of Material's main sheet: Job Separation's rows with the order
// value on one side and the material cost on the other.
//
// Each row carries three inputs the floor fills in — material (from the
// master list), material width in mm, running metres — and two figures the
// sheet works out: Expense (metres × width × ₹/m²) and Difference (order
// value − expense). The difference is the whole point of the screen: it is
// what tells the owner whether the order is worth taking.
//
// Editing is inline, per row, with an explicit Save: the figures preview
// live as the inputs change, so the floor sees the answer before committing
// it, and a row that has unsaved edits says so. "Request" sends the SAVED
// costing to the owner (the API builds the request from the row in the
// database, never from the form), which is why it is disabled while a row
// is dirty.
//
// Same scoping as the Job Separation worksheet — current month by default,
// searchable by sr. no, party, PO no, PM code or product — so a row found
// on one page is found on the other.
//
// Stock: once a row has a material and width, the Stock column shows what's
// on the rack for exactly that pair (BOM → Inventory), green when it covers
// the running metres and amber when it's short. "Use" takes the metres from
// stock against this job (part-used rolls first); "Return" puts them back.
// No stock, or not enough → Request as before.

import { useState, useEffect, useMemo, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Search, Send, Check, Undo2, SplitSquareHorizontal, Loader2, PackageMinus, PackageCheck, RotateCcw } from 'lucide-react';
import { useFitToViewport } from '@/hooks/useFitToViewport';
import toast from 'react-hot-toast';
import { cn, formatQty, formatNumericDate } from '@/lib/utils';
import { materialExpense, orderDifference, formatInr } from '@/lib/bom';
import { summariseStock, stockKey, describeRolls, formatMeters, type StockLine } from '@/lib/paperStock';
import { usePaperStock } from '@/hooks/usePaperStock';
import type { DateRange } from '@/lib/jobSeparationQuery';
import type { BomCostingRow, BomMaterial, BomMaterialRequest, BomRequestStatus } from '@/lib/types';
import { csvDate, type CsvColumn } from '@/lib/export/csv';
import { Button } from '@/components/ui/Button';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { PromptModal } from './modals';
import { useRefreshStock } from './PaperStockModals';
import CsvExportButton from './CsvExportButton';
import { SearchClearButton } from '@/components/ui/SearchClearButton';

// Loose on purpose — a costing is typed in over minutes, not seconds, and
// the poll pauses entirely while the tab is hidden. Paused altogether while
// any row has unsaved edits, so a refetch can't reset a half-typed number.
const POLL_MS = 30_000;

// Mirrors DEFAULT_LIMIT in src/lib/jobSeparationQuery.ts.
const PAGE_SIZE = 500;

const DATE_RANGE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: 'month',   label: 'Current month' },
  { value: '3months', label: 'Last 3 months' },
  { value: 'all',     label: 'All data' },
];

// Header labels, in the order the <td>s render below. Sr No is the floor's
// reference and stays pinned left; Request is the row's one action and
// stays right. PO No and PM Code aren't columns — they live in the card
// that opens on hovering / focusing / tapping the Sr No (SrNoCell), which
// keeps the sheet to one screen width. Search still matches them.
const COLUMNS = [
  'Sr No', 'Party', 'Product', 'Order Value',
  'Material', 'Width (mm)', 'Running (m)', 'Stock', 'Expense', 'Difference', 'Request',
] as const;

// Light-theme chips, per DESIGN.md §2.5 — colour encodes state only.
const REQUEST_CHIP: Record<BomRequestStatus, string> = {
  pending:   'bg-amber-100 text-amber-800 border-amber-200',
  ordered:   'bg-emerald-100 text-emerald-800 border-emerald-200',
  declined:  'bg-red-100 text-red-700 border-red-200',
  cancelled: 'bg-slate-100 text-slate-600 border-slate-200',
};

const REQUEST_LABEL: Record<BomRequestStatus, string> = {
  pending:   'Awaiting Admin',
  ordered:   'Ordered',
  declined:  'Declined',
  cancelled: 'Withdrawn',
};

// A stable reference for "no data yet" — `data?.rows ?? []` would otherwise
// hand back a fresh array every render, defeating the memos below.
const EMPTY_ROWS: BomCostingRow[] = [];
const EMPTY_MATERIALS: BomMaterial[] = [];

// One row's inputs as typed — strings, so a half-typed "12." survives a
// re-render. Keyed by job id in `drafts`; absent means "as saved".
type Draft = { material_id: string; width: string; metres: string };

function draftFromRow(row: BomCostingRow): Draft {
  return {
    material_id: row.costing?.material_id ?? '',
    width:       row.costing?.material_width_mm !== null && row.costing?.material_width_mm !== undefined
                   ? String(row.costing.material_width_mm) : '',
    metres:      row.costing?.running_meter !== null && row.costing?.running_meter !== undefined
                   ? String(row.costing.running_meter) : '',
  };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return a.material_id === b.material_id && a.width === b.width && a.metres === b.metres;
}

function num(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Exactly what's on screen — the saved figures, not the drafts.
type ExportRow = BomCostingRow & { expense: number | null; difference: number | null };

const EXPORT_COLUMNS: CsvColumn<ExportRow>[] = [
  { header: 'Sr. No.',        value: (r) => r.job.sr_no },
  { header: 'Party',          value: (r) => r.job.party },
  { header: 'PO No',          value: (r) => r.job.po_no },
  { header: 'PO Date',        value: (r) => csvDate(r.job.po_date) },
  { header: 'PM Code',        value: (r) => r.job.pm_code },
  { header: 'Product',        value: (r) => r.job.material_name },
  { header: 'Quantity',       value: (r) => r.job.quantity },
  { header: 'Order Value',    value: (r) => r.job.order_value },
  { header: 'Material',       value: (r) => r.costing?.material_name ?? null },
  { header: 'Rate per sq m',  value: (r) => r.costing?.rate_per_sqm ?? null },
  { header: 'Width (mm)',     value: (r) => r.costing?.material_width_mm ?? null },
  { header: 'Running (m)',    value: (r) => r.costing?.running_meter ?? null },
  { header: 'Issued from stock (m)',   value: (r) => r.stock_out_m || null },
  { header: 'Returned to stock (m)',   value: (r) => r.stock_returned_m || null },
  { header: 'Used from stock (m)',     value: (r) => r.stock_issued_m || null },
  { header: 'Expense',        value: (r) => r.expense },
  { header: 'Difference',     value: (r) => r.difference },
  { header: 'Request',        value: (r) => r.latest_request ? `${r.latest_request.ref} · ${REQUEST_LABEL[r.latest_request.status]}` : null },
];

type Props = { canDecide: boolean };

export default function BomCostingTable({ canDecide }: Props) {
  // The table scrolls, not the page — see useFitToViewport.
  const fitRef = useFitToViewport<HTMLDivElement>();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [range,  setRange]  = useState<DateRange>('month');
  const [limit,  setLimit]  = useState(PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);

  const [drafts,  setDrafts]  = useState<Record<string, Draft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  // The row whose Request message prompt is open.
  const [requesting, setRequesting] = useState<BomCostingRow | null>(null);
  // The row whose Use-from-stock / Return-to-stock prompt is open.
  const [issuing,   setIssuing]   = useState<{ row: BomCostingRow; line: StockLine } | null>(null);
  const [returning, setReturning] = useState<BomCostingRow | null>(null);
  const refreshStock = useRefreshStock();

  // Debounced only while typing — range changes apply immediately.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [debouncedSearch, range]);

  const dirtyCount = Object.keys(drafts).length;

  const rowsQuery = useQuery({
    queryKey: ['bom-costings', debouncedSearch, range, limit],
    queryFn: async () => {
      const params = new URLSearchParams({ range, limit: String(limit) });
      if (debouncedSearch) params.set('search', debouncedSearch);
      const res  = await fetch(`/api/bom-costings?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load Bill of Material');
      return { rows: (data.rows ?? []) as BomCostingRow[], hasMore: Boolean(data.hasMore) };
    },
    placeholderData: keepPreviousData,
    refetchInterval: dirtyCount > 0 || requesting || issuing || returning ? false : POLL_MS,
  });
  const rows    = rowsQuery.data?.rows ?? EMPTY_ROWS;
  const hasMore = rowsQuery.data?.hasMore ?? false;
  const loading = rowsQuery.isLoading;

  useEffect(() => {
    if (rowsQuery.error) toast.error((rowsQuery.error as Error).message);
  }, [rowsQuery.error]);

  useEffect(() => {
    if (!rowsQuery.isFetching) setLoadingMore(false);
  }, [rowsQuery.isFetching]);

  // The master list behind every row's dropdown. Retired materials are kept
  // (a row costed with one still needs to show its name) but only offered
  // on rows that already use them.
  const materialsQuery = useQuery({
    queryKey: ['bom-materials'],
    queryFn: async () => {
      const res  = await fetch('/api/bom-materials');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load materials');
      return (data.materials ?? []) as BomMaterial[];
    },
  });
  const materials = materialsQuery.data ?? EMPTY_MATERIALS;
  const materialsById = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);

  // What's on the rack, per material + width — same list as BOM → Inventory.
  const stockQuery = usePaperStock();
  const stockLines = useMemo(() => summariseStock(stockQuery.data ?? []), [stockQuery.data]);
  const stockByKey = useMemo(() => new Map(stockLines.map((l) => [l.key, l])), [stockLines]);

  // Saved figures only — what the CSV and the totals report. Drafts preview
  // in their own cells but never leak into a total someone might act on.
  const exportRows = useMemo<ExportRow[]>(
    () => rows.map((r) => {
      const expense = r.costing?.expense ?? null;
      return { ...r, expense, difference: orderDifference(r.job.order_value, expense) };
    }),
    [rows],
  );

  const totals = useMemo(() => {
    let orderValue = 0, expense = 0, priced = 0;
    for (const r of exportRows) {
      orderValue += r.job.order_value ?? 0;
      if (r.expense !== null) { expense += r.expense; priced += 1; }
    }
    return { orderValue, expense, priced, difference: orderValue - expense };
  }, [exportRows]);

  function draftFor(row: BomCostingRow): Draft {
    return drafts[row.job.id] ?? draftFromRow(row);
  }

  function updateDraft(row: BomCostingRow, patch: Partial<Draft>) {
    setDrafts((prev) => {
      const next = { ...(prev[row.job.id] ?? draftFromRow(row)), ...patch };
      // Typing back to the saved values un-dirties the row — no phantom
      // "unsaved" state for an edit that changed nothing.
      if (sameDraft(next, draftFromRow(row))) {
        const { [row.job.id]: _dropped, ...rest } = prev;
        return rest;
      }
      return { ...prev, [row.job.id]: next };
    });
  }

  function discardDraft(jobId: string) {
    setDrafts((prev) => {
      const { [jobId]: _dropped, ...rest } = prev;
      return rest;
    });
  }

  async function saveRow(row: BomCostingRow) {
    const draft = draftFor(row);
    const width  = num(draft.width);
    const metres = num(draft.metres);
    if (draft.width.trim()  && (width  === null || width  <= 0)) { toast.error('Width must be a number above 0'); return; }
    if (draft.metres.trim() && (metres === null || metres <= 0)) { toast.error('Running metres must be a number above 0'); return; }

    setSavingId(row.job.id);
    try {
      const res = await fetch(`/api/bom-costings/${row.job.id}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          material_id:       draft.material_id || null,
          material_width_mm: width,
          running_meter:     metres,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to save');
        return;
      }
      queryClient.setQueriesData<{ rows: BomCostingRow[]; hasMore: boolean }>(
        { queryKey: ['bom-costings'] },
        (old) => old
          ? { ...old, rows: old.rows.map((r) => (r.job.id === row.job.id ? { ...r, costing: data.costing } : r)) }
          : old
      );
      discardDraft(row.job.id);
      toast.success(`${row.job.sr_no ?? 'Row'} saved`);
    } catch {
      toast.error('Network error');
    } finally {
      setSavingId(null);
    }
  }

  async function sendRequest(row: BomCostingRow, message: string) {
    setSavingId(row.job.id);
    try {
      const res = await fetch('/api/bom-requests', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ job_separation_id: row.job.id, message }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to send request');
        return;
      }
      const request = data.request as BomMaterialRequest;
      queryClient.setQueriesData<{ rows: BomCostingRow[]; hasMore: boolean }>(
        { queryKey: ['bom-costings'] },
        (old) => old
          ? { ...old, rows: old.rows.map((r) => (r.job.id === row.job.id ? { ...r, latest_request: request } : r)) }
          : old
      );
      // The inbox and the nav badge both count this now.
      queryClient.invalidateQueries({ queryKey: ['bom-requests'] });
      toast.success(`${request.ref} sent to Admin`);
    } catch {
      toast.error('Network error');
    } finally {
      setSavingId(null);
    }
  }

  async function issueStock(row: BomCostingRow, meters: number) {
    setSavingId(row.job.id);
    try {
      const res = await fetch('/api/paper-stock/issue', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ job_separation_id: row.job.id, meters }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Failed to issue stock'); return; }
      refreshStock();
      toast.success(`${formatMeters(meters)} m issued to ${row.job.sr_no ?? row.job.party}`);
    } catch {
      toast.error('Network error');
    } finally {
      setSavingId(null);
    }
  }

  async function returnStock(row: BomCostingRow, meters: number) {
    setSavingId(row.job.id);
    try {
      const res = await fetch('/api/paper-stock/return', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ job_separation_id: row.job.id, meters }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Failed to return stock'); return; }
      refreshStock();
      toast.success(`${formatMeters(data.returned)} m returned to stock`);
    } catch {
      toast.error('Network error');
    } finally {
      setSavingId(null);
    }
  }

  function stockCellProps(row: BomCostingRow, draft: Draft, dirty: boolean) {
    return {
      row, draft, dirty, stockByKey, stockLines,
      busy:     savingId === row.job.id,
      onUse:    (line: StockLine) => setIssuing({ row, line }),
      onReturn: () => setReturning(row),
    };
  }

  return (
    <div className="space-y-3">
      {/* ── Toolbar ────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <select
          value={range}
          onChange={(e) => setRange(e.target.value as DateRange)}
          aria-label="Date range"
          title="Which rows to show and search"
          className={selectClass}
        >
          {DATE_RANGE_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>

        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--glass-muted)]"
            aria-hidden="true"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sr. no, party, PO no, PM code or product"
            aria-label="Search Bill of Material"
            title="Search (Ctrl+K)"
            data-global-search
            className={cn(inputClass, 'w-full pl-9 pr-11')}
          />
          <SearchClearButton value={search} onClear={() => setSearch('')} />
        </div>

        <CsvExportButton rows={exportRows} columns={EXPORT_COLUMNS} filename="bill-of-material" />
      </div>

      {/* ── Totals ─────────────────────────────────────────────── */}
      {!loading && rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="text-sm text-[var(--glass-muted)]">
            <strong className="text-[var(--glass-ink)]">{rows.length}</strong>
            {hasMore && '+'}
            {' '}{rows.length === 1 ? 'job' : 'jobs'}
            {search && ' matching your search'}
            {range !== 'all' && (
              <>{' '}in {DATE_RANGE_OPTIONS.find((r) => r.value === range)?.label.toLowerCase()}</>
            )}
            {' · '}
            <strong className="text-[var(--glass-ink)]">{totals.priced}</strong> priced
            {dirtyCount > 0 && (
              <span className="ml-2 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                {dirtyCount} unsaved
              </span>
            )}
          </p>

          {/* Saved figures only, and only across rows that have an expense
              — an order value with no expense against it would make the
              difference read better than anyone has actually established. */}
          <dl
            className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm"
            title={hasMore ? 'Totals only what’s loaded — narrow the search or "Load more" to cover the rest' : 'Totals of the rows shown, using saved figures'}
          >
            <Total label="Order value" value={totals.orderValue} />
            <Total label="Expense" value={totals.expense} />
            <Total
              label="Difference"
              value={totals.difference}
              tone={totals.difference < 0 ? 'text-red-700' : 'text-emerald-800'}
              starred={hasMore}
            />
          </dl>
        </div>
      )}

      {/* ── The sheet ──────────────────────────────────────────── */}
      {loading ? (
        <div className="rounded-xl glass overflow-hidden">
          <div ref={fitRef} className="table-scroll-wrapper relative max-h-[70vh] overflow-y-auto">
            <table className="w-full min-w-[1080px] border-collapse text-sm">
              <thead><tr>{COLUMNS.map((col) => <th key={col} scope="col" className={headerClass(col)}>{col}</th>)}</tr></thead>
              <tbody><SkeletonRows rows={6} cols={COLUMNS.length} /></tbody>
            </table>
          </div>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState hasSearch={Boolean(search)} range={range} />
      ) : (
        <>
          {/* Phone: one card per job, inputs stacked */}
          <ul className="sm:hidden space-y-3">
            {rows.map((row) => {
              const draft = draftFor(row);
              const dirty = row.job.id in drafts;
              const preview = previewFigures(row, draft, materialsById);
              return (
                <li key={row.job.id} className="glass rounded-xl p-4 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                      {row.job.sr_no ?? '—'}
                    </span>
                    {row.job.pm_code && <span className="font-mono text-xs text-[var(--glass-muted)]">{row.job.pm_code}</span>}
                    {row.latest_request && <RequestChip request={row.latest_request} />}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[var(--glass-ink)] break-words">{row.job.party}</p>
                    <p className="text-xs text-[var(--glass-muted)] break-words">
                      {row.job.material_name ?? '—'}{row.job.po_no ? ` · PO ${row.job.po_no}` : ''}
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-x-3 gap-y-1 text-xs">
                    <Figure label="Order value" value={row.job.order_value} />
                    <Figure label="Expense" value={preview.expense} dirty={dirty} />
                    <Figure label="Difference" value={preview.difference} dirty={dirty} signed />
                  </div>

                  <div className="space-y-2">
                    <MaterialSelect row={row} draft={draft} materials={materials} onChange={(v) => updateDraft(row, { material_id: v })} />
                    <div className="grid grid-cols-2 gap-2">
                      <NumberInput label="Width (mm)" value={draft.width} onChange={(v) => updateDraft(row, { width: v })} onEnter={() => saveRow(row)} />
                      <NumberInput label="Running (m)" value={draft.metres} onChange={(v) => updateDraft(row, { metres: v })} onEnter={() => saveRow(row)} />
                    </div>
                    <div>
                      <span className={fieldLabelClass}>Stock</span>
                      <StockCell {...stockCellProps(row, draft, dirty)} />
                    </div>
                  </div>

                  <RowActions
                    row={row}
                    dirty={dirty}
                    busy={savingId === row.job.id}
                    onSave={() => saveRow(row)}
                    onDiscard={() => discardDraft(row.job.id)}
                    onRequest={() => setRequesting(row)}
                    size="md"
                  />
                </li>
              );
            })}
          </ul>

          {/* Desk: the sheet, header pinned, rows scrolling */}
          <div className="hidden sm:block rounded-xl glass overflow-hidden">
            <div ref={fitRef} className="table-scroll-wrapper relative max-h-[70vh] overflow-y-auto">
              <table className="w-full min-w-[1080px] border-collapse text-sm">
                <thead>
                  <tr>{COLUMNS.map((col) => <th key={col} scope="col" className={headerClass(col)}>{col}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => {
                    const draft = draftFor(row);
                    const dirty = row.job.id in drafts;
                    const preview = previewFigures(row, draft, materialsById);
                    return (
                      <tr
                        key={row.job.id}
                        className={cn(
                          'border-b border-white/8 transition-colors hover:bg-black/[0.03]',
                          i % 2 === 1 && 'bg-[var(--glass-bg)]',
                          dirty && 'bg-amber-50/60',
                        )}
                      >
                        <td className="sticky left-0 z-10 px-3 py-1.5 whitespace-nowrap bg-[var(--glass-bg-strong)] backdrop-blur-[14px] border-r border-white/8">
                          <SrNoCell job={row.job} />
                        </td>
                        <td className={cn(cellClass, 'font-semibold whitespace-normal break-words min-w-[120px] max-w-[180px] text-[var(--glass-ink)]')}>{row.job.party}</td>
                        <td className={cn(cellClass, 'w-[200px] min-w-[160px] whitespace-normal break-words text-[var(--glass-muted)]')}>
                          {row.job.material_name ?? '—'}
                          {row.job.quantity !== null && (
                            <span className="block font-mono text-[11px]">{formatQty(row.job.quantity)} pcs</span>
                          )}
                        </td>
                        <td className={cn(cellClass, 'font-mono whitespace-nowrap text-right text-[var(--glass-ink)]')}>{formatInr(row.job.order_value)}</td>

                        {/* The floor's three inputs */}
                        <td className={cn(cellClass, 'min-w-[150px]')}>
                          <MaterialSelect row={row} draft={draft} materials={materials} compact onChange={(v) => updateDraft(row, { material_id: v })} />
                        </td>
                        <td className={cn(cellClass, 'w-[104px]')}>
                          <NumberInput compact label="Width (mm)" value={draft.width} onChange={(v) => updateDraft(row, { width: v })} onEnter={() => saveRow(row)} />
                        </td>
                        <td className={cn(cellClass, 'w-[112px]')}>
                          <NumberInput compact label="Running (m)" value={draft.metres} onChange={(v) => updateDraft(row, { metres: v })} onEnter={() => saveRow(row)} />
                        </td>
                        <td className={cn(cellClass, 'min-w-[130px]')}>
                          <StockCell {...stockCellProps(row, draft, dirty)} />
                        </td>

                        {/* The sheet's two answers */}
                        <td className={cn(cellClass, 'font-mono whitespace-nowrap text-right', dirty ? 'text-amber-800' : 'text-[var(--glass-ink)]')}
                            title={preview.rateNote ?? undefined}>
                          {formatInr(preview.expense)}
                          {preview.rateNote && <span className="block text-[10px] font-sans text-amber-700">{preview.rateNote}</span>}
                        </td>
                        <td className={cn(cellClass, 'font-mono whitespace-nowrap text-right font-semibold', differenceTone(preview.difference, dirty))}>
                          {signedInr(preview.difference)}
                          {preview.marginPct !== null && (
                            <span className="block text-[10px] font-normal opacity-80">{preview.marginPct}%</span>
                          )}
                        </td>

                        <td className="px-3 py-1.5 text-right whitespace-nowrap">
                          <RowActions
                            row={row}
                            dirty={dirty}
                            busy={savingId === row.job.id}
                            onSave={() => saveRow(row)}
                            onDiscard={() => discardDraft(row.job.id)}
                            onRequest={() => setRequesting(row)}
                            size="sm"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {hasMore && (
            <div className="flex justify-center pt-1">
              <Button
                onClick={() => { setLoadingMore(true); setLimit((l) => l + PAGE_SIZE); }}
                busy={loadingMore}
              >
                {`Load ${PAGE_SIZE} more jobs`}
              </Button>
            </div>
          )}
        </>
      )}

      {issuing && (() => {
        const { row, line } = issuing;
        const need = Math.max((row.costing?.running_meter ?? 0) - row.stock_issued_m, 0);
        const suggested = Math.min(need || line.meters, line.meters);
        return (
          <PromptModal
            title={`Use ${line.material_name} from stock for ${row.job.sr_no ?? row.job.party}`}
            description={
              <>
                <span className="font-mono">{formatMeters(line.width_mm)} mm</span> — {describeRolls(line)},{' '}
                <span className="font-mono">{formatMeters(line.meters)} m</span> on the rack
                {line.locations.length > 0 ? ` (${line.locations.join(', ')})` : ''}.
                {' '}Part-used rolls are taken first.
              </>
            }
            label="Metres to take from stock"
            kind="number"
            required
            initialValue={String(suggested)}
            confirmLabel="Use from stock"
            onCancel={() => setIssuing(null)}
            onConfirm={(value) => {
              setIssuing(null);
              issueStock(row, Number(value));
            }}
          />
        );
      })()}

      {/* Leftover after printing: the floor enters what came back, and it
          goes onto the roll this job took from last (the one off the press). */}
      {returning && (
        <PromptModal
          title={`Return leftover from ${returning.job.sr_no ?? returning.job.party}`}
          description={
            <>
              <span className="font-mono">{formatMeters(returning.stock_issued_m)} m</span> is out on this job
              {returning.stock_returned_m > 0 && (
                <> ({formatMeters(returning.stock_out_m)} m issued, {formatMeters(returning.stock_returned_m)} m already back)</>
              )}
              . Enter what&apos;s left after printing — it goes back onto the roll last used for this job.
            </>
          }
          label="Metres coming back to stock"
          kind="number"
          required
          confirmLabel="Return to stock"
          onCancel={() => setReturning(null)}
          onConfirm={(value) => {
            const row = returning;
            const meters = Number(value);
            if (meters > row.stock_issued_m) {
              toast.error(`Only ${formatMeters(row.stock_issued_m)} m is out on this job`);
              return;
            }
            setReturning(null);
            returnStock(row, meters);
          }}
        />
      )}

      {/* The one line to the owner. Optional — the row already says what
          and how much; this is for "stock is short" or "need by Friday". */}
      {requesting && (
        <PromptModal
          title={`Request ${requesting.costing?.material_name ?? 'material'} for ${requesting.job.sr_no ?? requesting.job.party}`}
          description={
            <>
              <span className="font-mono">{formatQty(requesting.costing?.running_meter ?? null)} m × {formatQty(requesting.costing?.material_width_mm ?? null)} mm</span>
              {' '}— ₹{formatInr(requesting.costing?.expense)} against an order of ₹{formatInr(requesting.job.order_value)}.
              {canDecide ? ' This goes to the Requests tab.' : ' Admin sees this in their Requests tab.'}
            </>
          }
          label="Message for Admin (optional)"
          example="stock is short — need by Friday"
          kind="textarea"
          confirmLabel="Send request"
          onCancel={() => setRequesting(null)}
          onConfirm={(message) => {
            const row = requesting;
            setRequesting(null);
            sendRequest(row, message);
          }}
        />
      )}
    </div>
  );
}

// ── Sr No + job reference card ─────────────────────────────────
// The sheet's pinned first cell. Hover, keyboard focus or a tap opens a
// small card with the PO no, PO date, PM code and quantity — the details
// that used to take two columns.
function SrNoCell({ job }: { job: BomCostingRow['job'] }) {
  const pop = useAnchoredPopover<HTMLButtonElement>(256, 170);
  const tipId = useId();

  return (
    <>
      <button
        ref={pop.ref}
        type="button"
        onMouseEnter={pop.open}
        onMouseLeave={pop.close}
        onFocus={pop.open}
        onBlur={pop.close}
        onClick={() => (pop.pos ? pop.close() : pop.open())}
        onKeyDown={(e) => { if (e.key === 'Escape') pop.close(); }}
        aria-describedby={pop.pos ? tipId : undefined}
        aria-label={`${job.sr_no ?? 'Row'} — show PO and PM details`}
        className="text-left rounded-md -mx-1 px-1 py-0.5 hover:bg-black/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70"
      >
        <span className="font-mono text-[13px] font-bold tracking-wide text-[var(--glass-ink)] underline decoration-dotted decoration-[var(--glass-muted)] underline-offset-4">
          {job.sr_no ?? '—'}
        </span>
        <span className="block text-[11px] text-[var(--glass-muted)] mt-0.5">{formatNumericDate(job.po_date)}</span>
      </button>

      {pop.pos && (
        <FloatingCard id={tipId} pos={pop.pos} width={256}>
          <p className="text-xs font-semibold text-[var(--glass-ink)] break-words">{job.party}</p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-[var(--glass-muted)]">PO No</dt>
            <dd className="font-mono text-[var(--glass-ink)] break-all">{job.po_no ?? '—'}</dd>
            <dt className="text-[var(--glass-muted)]">PO Date</dt>
            <dd className="font-mono text-[var(--glass-ink)]">{formatNumericDate(job.po_date)}</dd>
            <dt className="text-[var(--glass-muted)]">PM Code</dt>
            <dd className="font-mono text-[var(--glass-ink)] break-all">{job.pm_code ?? '—'}</dd>
            {job.quantity !== null && (
              <>
                <dt className="text-[var(--glass-muted)]">Quantity</dt>
                <dd className="font-mono text-[var(--glass-ink)]">{formatQty(job.quantity)} pcs</dd>
              </>
            )}
          </dl>
        </FloatingCard>
      )}
    </>
  );
}

// ── Row helpers ────────────────────────────────────────────────

type Preview = {
  expense:    number | null;
  difference: number | null;
  marginPct:  string | null;
  rateNote:   string | null;   // why a row can't be priced, if it can't
};

// Live figures from the draft (or the saved row when there is no draft).
// The rate comes from the master list on the client, so the preview and the
// saved figure agree to the paisa — same formula, same inputs.
function previewFigures(row: BomCostingRow, draft: Draft, materialsById: Map<string, BomMaterial>): Preview {
  const material = draft.material_id ? materialsById.get(draft.material_id) : undefined;
  const rate = material ? material.rate_per_sqm : null;
  const width = num(draft.width);
  const metres = num(draft.metres);
  const expense = materialExpense(metres, width, rate);
  const difference = orderDifference(row.job.order_value, expense);
  const marginPct = difference !== null && row.job.order_value
    ? ((difference / row.job.order_value) * 100).toFixed(1)
    : null;
  const rateNote = material && !(rate && rate > 0) ? 'No rate on master' : null;
  return { expense, difference, marginPct, rateNote };
}

function signedInr(value: number | null): string {
  if (value === null) return '—';
  return (value < 0 ? '−' : '') + formatInr(Math.abs(value));
}

function differenceTone(value: number | null, dirty: boolean): string {
  if (value === null) return 'text-[var(--glass-muted)]';
  if (dirty) return 'text-amber-800';
  return value < 0 ? 'text-red-700' : 'text-emerald-800';
}

function MaterialSelect({
  row, draft, materials, compact = false, onChange,
}: {
  row: BomCostingRow; draft: Draft; materials: BomMaterial[]; compact?: boolean; onChange: (v: string) => void;
}) {
  // Active materials only, plus whichever retired one this row already
  // uses — it can stay, it just can't be picked fresh.
  const options = materials.filter((m) => m.is_active || m.id === draft.material_id);
  return (
    <label className="block">
      {!compact && <span className={fieldLabelClass}>Material</span>}
      <select
        value={draft.material_id}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`Material for ${row.job.sr_no ?? row.job.party}`}
        className={cn(selectClass, 'w-full', compact && 'min-h-9 text-[13px] px-2')}
      >
        <option value="">— pick material —</option>
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}{m.rate_per_sqm > 0 ? ` · ₹${formatInr(m.rate_per_sqm)}/m²` : ' · no rate'}{m.is_active ? '' : ' (retired)'}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberInput({
  label, value, compact = false, onChange, onEnter,
}: {
  label: string; value: string; compact?: boolean; onChange: (v: string) => void; onEnter: () => void;
}) {
  return (
    <label className="block">
      {!compact && <span className={fieldLabelClass}>{label}</span>}
      <input
        type="number"
        min="0"
        step="any"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } }}
        aria-label={label}
        // Just the unit in the cramped table cell — "Running" gets clipped
        // at this column width, and the header already says what it is.
        placeholder={compact ? (label.match(/\((.*)\)$/)?.[1] ?? label) : ''}
        className={cn(inputClass, 'w-full font-mono tabular-nums text-right', compact && 'min-h-9 text-[13px] px-2')}
      />
    </label>
  );
}

// What's on the rack for this row's material + width. Reads the DRAFT so the
// answer appears the moment a material and width are picked, before Save —
// but "Use" waits for a saved row, since the API issues against the saved
// costing (same rule as Request).
//
// Kept to one line so the row stays the height of its inputs:
//   [8,650 m · 5 rolls]  ← thin bar underneath: how much of the need it covers
//   [✓ 5,000 m]           ← what this job has from stock; tap for the
//                            issued / returned / used card + Return leftover
//   [⊟]                   ← Use from stock
// The long-form detail (full/part rolls, location, shortfall, wider widths)
// is in the tooltip rather than on the row.
function StockCell({
  row, draft, dirty, stockByKey, stockLines, busy, onUse, onReturn,
}: {
  row: BomCostingRow; draft: Draft; dirty: boolean;
  stockByKey: Map<string, StockLine>; stockLines: StockLine[];
  busy: boolean; onUse: (line: StockLine) => void; onReturn: () => void;
}) {
  const width = num(draft.width);
  const issued = row.stock_issued_m;
  const usage = issued > 0 ? <StockUsagePill row={row} busy={busy} onReturn={onReturn} /> : null;

  if (!draft.material_id || !width || width <= 0) {
    return usage ?? <span className="text-xs text-[var(--glass-muted)]">—</span>;
  }

  const line = stockByKey.get(stockKey(draft.material_id, width));
  const need = Math.max((num(draft.metres) ?? 0) - issued, 0);
  const short = line && need > 0 && line.meters < need ? Math.round((need - line.meters) * 100) / 100 : 0;

  // Same material, wider rolls — could be slit down. A hint, not an option.
  const wider = line ? [] : stockLines.filter((l) => l.material_id === draft.material_id && l.width_mm > width);

  const saved = !dirty && row.costing?.material_id === draft.material_id && row.costing?.material_width_mm === width;
  const canUse = saved && line && line.meters > 0 && (need > 0 || !row.costing?.running_meter);

  const detail = line
    ? [
        `${describeRolls(line)} · ${formatMeters(line.meters)} m on the rack`,
        line.locations.length ? `at ${line.locations.join(', ')}` : '',
        short ? `short ${formatMeters(short)} m for this job` : need > 0 ? 'covers this job' : '',
      ].filter(Boolean).join('\n')
    : wider.length
      ? `None at ${formatMeters(width)} mm. Wider rolls of this material:\n` +
        wider.map((l) => `${formatMeters(l.width_mm)} mm — ${formatMeters(l.meters)} m`).join('\n')
      : `None at ${formatMeters(width)} mm — send a Request`;

  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      {line ? (
        <div className="min-w-0" title={detail}>
          <p className="leading-none">
            <span className={cn('font-mono text-[13px] font-semibold', short ? 'text-amber-800' : 'text-emerald-800')}>
              {formatMeters(line.meters)}
            </span>
            <span className="text-[11px] text-[var(--glass-muted)]"> m · {line.rolls} roll{line.rolls === 1 ? '' : 's'}</span>
          </p>
          {need > 0 && (
            <div className="mt-1 h-1 w-16 rounded-full bg-black/[0.07] overflow-hidden" aria-hidden="true">
              <div
                className={cn('h-full rounded-full', short ? 'bg-amber-500' : 'bg-emerald-500')}
                style={{ width: `${Math.min(100, Math.round((line.meters / need) * 100))}%` }}
              />
            </div>
          )}
          <span className="sr-only">{detail}</span>
        </div>
      ) : (
        <span className="text-xs font-medium text-red-700" title={detail}>
          No stock
          {wider.length > 0 && (
            <span className="ml-1 rounded bg-slate-100 px-1 py-px text-[10px] font-normal text-slate-600">wider</span>
          )}
          <span className="sr-only">. {detail}</span>
        </span>
      )}

      {usage}

      {canUse && (
        <Button
          size="sm"
          intent="tinted"
          icon={PackageMinus}
          busy={busy}
          onClick={() => onUse(line!)}
          aria-label="Use from stock"
          title="Use from stock — take this job's metres off the rack"
          className="ml-auto !px-2"
        />
      )}
    </div>
  );
}

// "✓ 5,000 m" — what this job has taken from stock (net of returns). Tap it
// for the breakdown and the Return leftover action, so the numbers don't
// have to sit on the row.
function StockUsagePill({ row, busy, onReturn }: { row: BomCostingRow; busy: boolean; onReturn: () => void }) {
  const pop = useAnchoredPopover<HTMLButtonElement>(224, 150);
  const cardId = useId();
  const returned = row.stock_returned_m > 0;

  return (
    <>
      <button
        ref={pop.ref}
        type="button"
        onClick={() => (pop.pos ? pop.close() : pop.open())}
        aria-expanded={!!pop.pos}
        aria-controls={pop.pos ? cardId : undefined}
        aria-label={`${returned ? 'Used' : 'Issued'} ${formatMeters(row.stock_issued_m)} m from stock — details`}
        className={cn(
          'inline-flex items-center gap-1 min-h-9 rounded-lg border px-2 text-[11px] font-semibold font-mono tabular-nums transition-colors',
          'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70',
          pop.pos && 'bg-emerald-100',
        )}
      >
        <PackageCheck className="h-3.5 w-3.5" aria-hidden="true" />
        {formatMeters(row.stock_issued_m)}
      </button>

      {pop.pos && (
        <FloatingCard id={cardId} pos={pop.pos} anchorRef={pop.ref} onDismiss={pop.close} interactive width={224}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--glass-muted)]">Paper from stock</p>
          <dl className="mt-2 space-y-1 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--glass-muted)]">Issued</dt>
              <dd className="font-mono text-[var(--glass-ink)]">{formatMeters(row.stock_out_m)} m</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--glass-muted)]">Returned</dt>
              <dd className="font-mono text-[var(--glass-ink)]">{returned ? `− ${formatMeters(row.stock_returned_m)} m` : '—'}</dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-black/[0.06] pt-1">
              <dt className="font-semibold text-[var(--glass-ink)]">Used on this job</dt>
              <dd className="font-mono font-semibold text-emerald-800">{formatMeters(row.stock_issued_m)} m</dd>
            </div>
          </dl>
          <Button
            size="sm"
            icon={RotateCcw}
            block
            disabled={busy}
            className="mt-3"
            onClick={() => { pop.close(); onReturn(); }}
          >
            Return leftover
          </Button>
        </FloatingCard>
      )}
    </>
  );
}

// ── Anchored floating card ─────────────────────────────────────
// Fixed-position card portalled to <body>, so the sheet's scroll container
// can't clip it. Opens below its anchor (above, near the bottom of the
// screen), clamped inside the viewport; closes on scroll/resize. Used by
// the Sr No reference card (hover) and the stock usage card (tap).

type Anchor = { left: number; top: number; above: boolean };

function useAnchoredPopover<T extends HTMLElement>(width: number, height: number) {
  const ref = useRef<T>(null);
  const [pos, setPos] = useState<Anchor | null>(null);

  const open = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const above = r.bottom + height + 12 > window.innerHeight;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setPos({ left, top: above ? r.top - 6 : r.bottom + 6, above });
  };
  const close = () => setPos(null);

  useEffect(() => {
    if (!pos) return;
    const dismiss = () => setPos(null);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [pos]);

  return { ref, pos, open, close };
}

function FloatingCard({
  id, pos, width, interactive = false, anchorRef, onDismiss, children,
}: {
  id: string; pos: Anchor; width: number; interactive?: boolean;
  anchorRef?: React.RefObject<HTMLElement | null>; onDismiss?: () => void; children: React.ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Interactive cards close on a click elsewhere or Escape.
  useEffect(() => {
    if (!interactive || !onDismiss) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (cardRef.current?.contains(t) || anchorRef?.current?.contains(t)) return;
      onDismiss();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss(); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [interactive, onDismiss, anchorRef]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="admin-light contents">
      <div
        ref={cardRef}
        id={id}
        role={interactive ? 'dialog' : 'tooltip'}
        style={{ left: pos.left, top: pos.top, width, transform: pos.above ? 'translateY(-100%)' : undefined }}
        className={cn(
          'fixed z-[60] rounded-xl border border-black/[0.08] bg-white p-3 shadow-xl shadow-black/10',
          !interactive && 'pointer-events-none',
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

function RowActions({
  row, dirty, busy, onSave, onDiscard, onRequest, size,
}: {
  row: BomCostingRow; dirty: boolean; busy: boolean;
  onSave: () => void; onDiscard: () => void; onRequest: () => void; size: 'sm' | 'md';
}) {
  // Unsaved edits: the row's one job is to get saved. Request would send
  // the OLD numbers (the API reads the database, not the form), so it
  // steps aside until the edit is committed or dropped.
  if (dirty) {
    return (
      <div className="inline-flex items-center gap-1.5">
        <Button intent="primary" size={size} icon={Check} busy={busy} onClick={onSave}>Save</Button>
        <Button size={size} icon={Undo2} onClick={onDiscard} aria-label="Discard changes" title="Discard changes" />
      </div>
    );
  }

  const priceable = row.costing?.expense !== null && row.costing?.expense !== undefined;
  const open = row.latest_request?.status === 'pending';

  return (
    <div className={cn('inline-flex items-center gap-1.5', size === 'md' && 'w-full justify-between')}>
      {row.latest_request && <RequestChip request={row.latest_request} />}
      {open ? null : busy ? (
        <Loader2 className="h-4 w-4 animate-spin text-[var(--glass-muted)]" aria-hidden="true" />
      ) : (
        <Button
          intent={row.latest_request ? 'ghost' : 'tinted'}
          size={size}
          icon={Send}
          disabled={!priceable}
          title={priceable ? 'Send this material request to Admin' : 'Pick a material and enter width and metres first'}
          onClick={onRequest}
        >
          {row.latest_request ? 'Request again' : 'Request'}
        </Button>
      )}
    </div>
  );
}

function RequestChip({ request }: { request: BomMaterialRequest }) {
  return (
    <span
      className={cn('inline-block rounded-md border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap', REQUEST_CHIP[request.status])}
      title={`${request.ref} · ${formatNumericDate(request.created_at)}`}
    >
      {REQUEST_LABEL[request.status]}
    </span>
  );
}

function Figure({ label, value, dirty = false, signed = false }: { label: string; value: number | null; dirty?: boolean; signed?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--glass-muted)]">{label}</p>
      <p className={cn('font-mono text-sm font-semibold truncate', signed ? differenceTone(value, dirty) : dirty ? 'text-amber-800' : 'text-[var(--glass-ink)]')}>
        {signed ? signedInr(value) : formatInr(value)}
      </p>
    </div>
  );
}

function Total({ label, value, tone = 'text-[var(--glass-ink)]', starred = false }: { label: string; value: number; tone?: string; starred?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-xs text-[var(--glass-muted)]">{label}</dt>
      <dd className={cn('font-mono font-semibold tabular-nums', tone)}>
        ₹{signedInr(value)}{starred && <span className="text-emerald-700">*</span>}
      </dd>
    </div>
  );
}

function EmptyState({ hasSearch, range }: { hasSearch: boolean; range: DateRange }) {
  const scope = range === 'all' ? '' : ` in ${DATE_RANGE_OPTIONS.find((r) => r.value === range)?.label.toLowerCase()}`;
  return (
    <div className="flex flex-col items-center justify-center text-center rounded-xl border border-black/[0.08] bg-white px-4 py-12">
      <SplitSquareHorizontal className="w-6 h-6 text-[var(--glass-muted)]" aria-hidden="true" />
      <p className="text-sm font-medium text-[var(--glass-ink)] mt-3">
        {hasSearch ? `No job matches that search${scope}.` : `No jobs${scope}.`}
      </p>
      <p className="text-xs text-[var(--glass-muted)] mt-1 max-w-[42ch]">
        {hasSearch
          ? 'Try the sr. no, party, PO no, PM code or product — or widen the date range.'
          : 'Rows appear here as Prepress adds them to Job Separation.'}
      </p>
    </div>
  );
}

// ── Shared class strings ───────────────────────────────────────

const fieldLabelClass = 'mb-1 block text-[10px] font-medium uppercase tracking-wide text-[var(--glass-muted)]';

const inputClass =
  'min-h-11 px-3 rounded-lg text-sm bg-[var(--field-bg)] border border-[var(--field-border)] text-[var(--glass-ink)] ' +
  'placeholder:text-[var(--glass-muted)] focus:outline-none focus:border-emerald-300/70 ' +
  'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all';

const selectClass =
  'min-h-11 px-3 rounded-lg text-sm shrink-0 bg-[var(--field-bg)] border border-[var(--field-border)] text-[var(--glass-ink)] ' +
  'focus:outline-none focus:border-emerald-300/70 focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all';

const cellClass = 'px-3 py-1.5 align-top border-r border-white/8';

function headerClass(col: typeof COLUMNS[number]): string {
  return cn(
    'sticky top-0 z-10 px-3 py-1.5 text-left text-[11px] font-semibold text-[var(--glass-muted)]',
    'uppercase tracking-[0.06em] whitespace-nowrap bg-[var(--glass-bg-strong)] backdrop-blur-[14px]',
    'border-b border-white/12',
    (col === 'Order Value' || col === 'Expense' || col === 'Difference') && 'text-right',
    col === 'Request' && 'text-right',
    col === 'Sr No' && 'left-0 z-20 border-r border-white/12',
    col !== 'Request' && col !== 'Sr No' && 'border-r border-white/8',
  );
}
