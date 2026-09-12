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

import { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Search, Send, Check, Undo2, SplitSquareHorizontal, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, formatQty, formatNumericDate } from '@/lib/utils';
import { materialExpense, orderDifference, formatInr } from '@/lib/bom';
import type { DateRange } from '@/lib/jobSeparationQuery';
import type { BomCostingRow, BomMaterial, BomMaterialRequest, BomRequestStatus } from '@/lib/types';
import { csvDate, type CsvColumn } from '@/lib/export/csv';
import { Button } from '@/components/ui/Button';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { PromptModal } from './modals';
import CsvExportButton from './CsvExportButton';

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
// stays right.
const COLUMNS = [
  'Sr No', 'Party', 'PO No', 'PM Code', 'Product', 'Order Value',
  'Material', 'Width (mm)', 'Running (m)', 'Expense', 'Difference', 'Request',
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
  { header: 'Expense',        value: (r) => r.expense },
  { header: 'Difference',     value: (r) => r.difference },
  { header: 'Request',        value: (r) => r.latest_request ? `${r.latest_request.ref} · ${REQUEST_LABEL[r.latest_request.status]}` : null },
];

type Props = { canDecide: boolean };

export default function BomCostingTable({ canDecide }: Props) {
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [range,  setRange]  = useState<DateRange>('month');
  const [limit,  setLimit]  = useState(PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);

  const [drafts,  setDrafts]  = useState<Record<string, Draft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  // The row whose Request message prompt is open.
  const [requesting, setRequesting] = useState<BomCostingRow | null>(null);

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
    refetchInterval: dirtyCount > 0 || requesting ? false : POLL_MS,
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
            className={cn(inputClass, 'w-full pl-9')}
          />
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
          <div className="table-scroll-wrapper max-h-[70vh] overflow-y-auto">
            <table className="w-full min-w-[1180px] border-collapse text-sm">
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
            <div className="table-scroll-wrapper max-h-[70vh] overflow-y-auto">
              <table className="w-full min-w-[1180px] border-collapse text-sm">
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
                          <span className="font-mono text-[13px] font-bold tracking-wide text-[var(--glass-ink)]">{row.job.sr_no ?? '—'}</span>
                          <p className="text-[11px] text-[var(--glass-muted)] mt-0.5">{formatNumericDate(row.job.po_date)}</p>
                        </td>
                        <td className={cn(cellClass, 'font-semibold whitespace-normal break-words min-w-[120px] text-[var(--glass-ink)]')}>{row.job.party}</td>
                        <td className={cn(cellClass, 'font-mono text-[13px] max-w-[130px]', (row.job.po_no?.length ?? 0) > 12 ? 'whitespace-normal break-all' : 'whitespace-nowrap')}>{row.job.po_no ?? '—'}</td>
                        <td className={cn(cellClass, 'font-mono text-[13px] whitespace-nowrap')}>{row.job.pm_code ?? '—'}</td>
                        <td className={cn(cellClass, 'w-[180px] min-w-0 whitespace-normal break-words text-[var(--glass-muted)]')}>
                          {row.job.material_name ?? '—'}
                          {row.job.quantity !== null && (
                            <span className="block font-mono text-[11px]">{formatQty(row.job.quantity)} pcs</span>
                          )}
                        </td>
                        <td className={cn(cellClass, 'font-mono whitespace-nowrap text-right text-[var(--glass-ink)]')}>{formatInr(row.job.order_value)}</td>

                        {/* The floor's three inputs */}
                        <td className={cn(cellClass, 'min-w-[170px]')}>
                          <MaterialSelect row={row} draft={draft} materials={materials} compact onChange={(v) => updateDraft(row, { material_id: v })} />
                        </td>
                        <td className={cn(cellClass, 'w-[104px]')}>
                          <NumberInput compact label="Width (mm)" value={draft.width} onChange={(v) => updateDraft(row, { width: v })} onEnter={() => saveRow(row)} />
                        </td>
                        <td className={cn(cellClass, 'w-[112px]')}>
                          <NumberInput compact label="Running (m)" value={draft.metres} onChange={(v) => updateDraft(row, { metres: v })} onEnter={() => saveRow(row)} />
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
          kind="textarea"
          placeholder="e.g. stock is short — need by Friday"
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
