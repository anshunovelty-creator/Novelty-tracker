'use client';
// src/components/admin/JobSeparationManager.tsx
// The live Job Separation worksheet — every PO line item Prepress has split
// out, searchable by sr. no, party, PO no, PM code or material.
//
// Read-only for most departments; Prepress and Admin own the entries. The
// list polls quietly in the background (see the effect below) so a row
// someone else just added shows up without a manual refresh — the same
// visibility-aware pattern the room displays use, not Supabase Realtime.

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Search, Plus, Pencil, Copy, Trash2, SplitSquareHorizontal, ArrowUp, ArrowDown, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, formatQty, formatNumericDate } from '@/lib/utils';
import { csvDate, csvTimestamp, type CsvColumn } from '@/lib/export/csv';
import type { JobSeparation } from '@/lib/types';
import AddJobSeparationModal from './AddJobSeparationModal';
import ManagePartiesModal from './ManagePartiesModal';
import PrepressTodoPanel from './PrepressTodoPanel';
import CsvExportButton from './CsvExportButton';
import { SkeletonRows } from '@/components/ui/Skeleton';

// Header labels for the desk table, one column per worksheet field plus
// actions. "Added" is deliberately left out here — it's in the CSV export
// but kept out of the table to hold off horizontal scroll on desktop.
// Must stay in the same order as the <td>s rendered below.
const JOB_SEPARATION_COLUMNS = [
  'Sr No', 'Party', 'PO No', 'PO Date', 'PM Code / Material', 'Qty', 'Unit',
  'Rate', 'Order Value', 'Job Status', 'JC Status', 'AW', 'Actions',
] as const;
const JOB_SEPARATION_COLS = JOB_SEPARATION_COLUMNS.length;

// How often the list quietly re-fetches so a row someone else just added
// shows up without a manual refresh. Loose on purpose — this is a reference
// worksheet, not a wall display — and paused while the tab isn't visible.
const POLL_MS = 30_000;

// Mirrors DEFAULT_LIMIT in src/app/api/job-separations/route.ts. "Current
// month" (400-700 rows) fits in one page today; "All data" won't once it
// covers years of history, so it's capped the same way and grown via
// "Load more" instead of fetched in one shot.
const PAGE_SIZE = 500;

// Mirrors JOB_SEPARATION_SEARCH_FIELDS in src/app/api/job-separations/route.ts
// — the value sent as ?field=. "All fields" (value 'all') skips the param,
// falling back to the server's multi-column OR search.
// Mirrors DateRange in src/app/api/job-separations/route.ts — the value
// sent as ?range=. Scopes both the default view and every search: at
// 400-700 rows added a month, "Current month" keeps the list (and the
// query) from growing unbounded the way "All data" eventually will.
type DateRangeOption = 'month' | '3months' | 'all';

const DATE_RANGE_OPTIONS: { value: DateRangeOption; label: string }[] = [
  { value: 'month',    label: 'Current month' },
  { value: '3months',  label: 'Last 3 months' },
  { value: 'all',      label: 'All data' },
];

const JOB_SEPARATION_SEARCH_FIELDS: { value: string; label: string; placeholder: string }[] = [
  { value: 'all',           label: 'All fields',   placeholder: 'Search sr. no, party, PO no, PM code or material' },
  { value: 'sr_no',         label: 'Sr. No.',      placeholder: 'Search by sr. no' },
  { value: 'party',         label: 'Party',        placeholder: 'Search by party' },
  { value: 'po_no',         label: 'PO No.',       placeholder: 'Search by PO no' },
  { value: 'pm_code',       label: 'PM code',      placeholder: 'Search by PM code' },
  { value: 'material_name', label: 'Material',     placeholder: 'Search by material name' },
  { value: 'unit',          label: 'Unit',         placeholder: 'Search by unit' },
  { value: 'quantity',      label: 'Quantity',     placeholder: 'Search by quantity' },
  { value: 'job_status',    label: 'Job status',   placeholder: 'Search by job status' },
  { value: 'jc_status',     label: 'JC status',    placeholder: 'Search by JC status' },
  { value: 'aw_send_to',    label: 'AW send to',   placeholder: 'Search by AW send to' },
];

// Sort by any field, either direction — unlike Jobs (JOB_SORT_OPTIONS in
// src/lib/utils.ts), which only ever needed three fields so a combined
// field+direction dropdown was fine. Fourteen sortable fields here would
// make that list unreadable, so field and direction are two controls.
type SortField =
  | 'sr_no' | 'party' | 'po_no' | 'po_date' | 'pm_code' | 'material_name'
  | 'quantity' | 'unit' | 'job_status' | 'rate' | 'order_value' | 'jc_status'
  | 'aw_send_to' | 'created_at';
type SortDir = 'asc' | 'desc';

const SORT_FIELDS: { value: SortField; label: string }[] = [
  { value: 'created_at',    label: 'Added' },
  { value: 'sr_no',         label: 'Sr. No.' },
  { value: 'party',         label: 'Party' },
  { value: 'po_no',         label: 'PO No' },
  { value: 'po_date',       label: 'PO Date' },
  { value: 'pm_code',       label: 'PM Code' },
  { value: 'material_name', label: 'Material' },
  { value: 'quantity',      label: 'Quantity' },
  { value: 'unit',          label: 'Unit' },
  { value: 'job_status',    label: 'Job Status' },
  { value: 'rate',          label: 'Rate' },
  { value: 'order_value',   label: 'Order Value' },
  { value: 'jc_status',     label: 'JC Status' },
  { value: 'aw_send_to',    label: 'AW send to' },
];

const SORT_FIELD_KIND: Record<SortField, 'text' | 'number' | 'date'> = {
  sr_no: 'text', party: 'text', po_no: 'text', po_date: 'date', pm_code: 'text',
  material_name: 'text', quantity: 'number', unit: 'text', job_status: 'text',
  rate: 'number', order_value: 'number', jc_status: 'text', aw_send_to: 'text',
  created_at: 'date',
};

// Ascending comparator. Nulls always sort to the end regardless of
// direction — same rule delivery_date sorting uses in sortJobs (utils.ts):
// "not set" reads as "furthest away," in either direction.
function compareRows(a: JobSeparation, b: JobSeparation, field: SortField): number {
  const av = a[field];
  const bv = b[field];
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;

  const kind = SORT_FIELD_KIND[field];
  if (kind === 'number') return (av as number) - (bv as number);
  if (kind === 'date') return new Date(av as string).getTime() - new Date(bv as string).getTime();
  return (av as string).localeCompare(bv as string, undefined, { numeric: true, sensitivity: 'base' });
}

function sortRows(rows: JobSeparation[], field: SortField, dir: SortDir): JobSeparation[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    const diff = compareRows(a, b, field);
    return dir === 'asc' ? diff : -diff;
  });
  return sorted;
}

function formatMoney(value: number | null): string | null {
  if (value === null) return null;
  return value.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

const JOB_SEPARATION_EXPORT_COLUMNS: CsvColumn<JobSeparation>[] = [
  { header: 'Sr. No.',        value: (j) => j.sr_no },
  { header: 'Party',          value: (j) => j.party },
  { header: 'Po No',          value: (j) => j.po_no },
  { header: 'Po Date',        value: (j) => csvDate(j.po_date) },
  { header: 'PM Code',        value: (j) => j.pm_code },
  { header: 'Material Name',  value: (j) => j.material_name },
  { header: 'Quantity',       value: (j) => j.quantity },
  { header: 'Unit',           value: (j) => j.unit },
  { header: 'Job Status',     value: (j) => j.job_status },
  { header: 'Rate',           value: (j) => j.rate },
  { header: 'Order Value',    value: (j) => j.order_value },
  { header: 'JC Status',      value: (j) => j.jc_status },
  { header: 'AW send to',     value: (j) => j.aw_send_to },
  { header: 'Added',          value: (j) => csvTimestamp(j.created_at) },
];

export default function JobSeparationManager({ canManage }: { canManage: boolean }) {
  const [rows,        setRows]        = useState<JobSeparation[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState('');
  const [searchField, setSearchField] = useState('all');
  const [range,       setRange]       = useState<DateRangeOption>('month');
  const [sortField,   setSortField]   = useState<SortField>('created_at');
  const [sortDir,     setSortDir]     = useState<SortDir>('desc');
  const [adding,      setAdding]      = useState(false);
  const [editing,     setEditing]     = useState<JobSeparation | null>(null);
  // Set when "Duplicate" is used instead of "Add row" — seeds the add form
  // with this row's fields (a fresh POST, not a PATCH to this row).
  const [duplicateSource, setDuplicateSource] = useState<JobSeparation | null>(null);
  // The row whose Delete has been armed. Deleting is two taps, never a dialog.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busyId,     setBusyId]     = useState<string | null>(null);
  const [managingParties, setManagingParties] = useState(false);
  const [limit,       setLimit]       = useState(PAGE_SIZE);
  const [hasMore,     setHasMore]     = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // First load shows the skeleton; background polls should not — nobody
  // wants the whole list to flash empty every 30s while they're reading it.
  const firstLoad = useRef(true);

  const load = useCallback(async () => {
    if (firstLoad.current) setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('range', range);
      params.set('limit', String(limit));
      if (search) {
        params.set('search', search);
        if (searchField !== 'all') params.set('field', searchField);
      }
      const res  = await fetch(`/api/job-separations?${params.toString()}`);
      const data = await res.json();
      if (res.ok) {
        setRows(data.job_separations ?? []);
        setHasMore(Boolean(data.hasMore));
      } else if (firstLoad.current) toast.error(data.error ?? 'Failed to load job separation rows');
    } catch {
      if (firstLoad.current) toast.error('Network error');
    } finally {
      setLoading(false);
      setLoadingMore(false);
      firstLoad.current = false;
    }
  }, [search, searchField, range, limit]);

  // A new search/field/range starts back at page one — the limit a previous
  // "Load more" click reached doesn't carry over to an unrelated query.
  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [search, searchField, range]);

  useEffect(() => {
    const timer = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  function loadMore() {
    setLoadingMore(true);
    setLimit((l) => l + PAGE_SIZE);
  }

  // Quiet background refresh — paused while the tab isn't visible, and
  // caught up immediately the moment it becomes visible again.
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === 'visible') load();
    }
    document.addEventListener('visibilitychange', handleVisibility);
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, POLL_MS);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      clearInterval(interval);
    };
  }, [load]);

  const sortedRows = useMemo(
    () => sortRows(rows, sortField, sortDir),
    [rows, sortField, sortDir],
  );

  async function remove(row: JobSeparation) {
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/job-separations/${row.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to delete row');
        return;
      }
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      toast.success('Row deleted');
    } catch {
      toast.error('Network error');
    } finally {
      setBusyId(null);
      setConfirming(null);
    }
  }

  return (
    <div className="space-y-3">
      {canManage && <PrepressTodoPanel />}

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <select
          value={range}
          onChange={(e) => setRange(e.target.value as DateRangeOption)}
          aria-label="Date range"
          title="Which rows to show and search"
          className={cn(
            'min-h-11 px-3 rounded-xl text-sm shrink-0',
            'bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--glass-ink)]',
            'focus:outline-none focus:border-emerald-300/70 focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
          )}
        >
          {DATE_RANGE_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>

        <select
          value={searchField}
          onChange={(e) => setSearchField(e.target.value)}
          aria-label="Search field"
          title="Narrow the search to one field"
          className={cn(
            'min-h-11 px-3 rounded-xl text-sm shrink-0',
            'bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--glass-ink)]',
            'focus:outline-none focus:border-emerald-300/70 focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
          )}
        >
          {JOB_SEPARATION_SEARCH_FIELDS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
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
            placeholder={JOB_SEPARATION_SEARCH_FIELDS.find((f) => f.value === searchField)?.placeholder}
            aria-label="Search job separation"
            title="Search (Ctrl+K)"
            data-global-search
            className={cn(
              'w-full min-h-11 pl-9 pr-3 rounded-xl text-sm',
              'bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--glass-ink)]',
              'placeholder:text-[var(--glass-muted)] focus:outline-none',
              'focus:border-emerald-300/70 focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
            )}
          />
        </div>

        <select
          value={sortField}
          onChange={(e) => setSortField(e.target.value as SortField)}
          aria-label="Sort by field"
          title="Sort by"
          className={cn(
            'min-h-11 px-3 rounded-xl text-sm shrink-0',
            'bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--glass-ink)]',
            'focus:outline-none focus:border-emerald-300/70 focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
          )}
        >
          {SORT_FIELDS.map((f) => (
            <option key={f.value} value={f.value}>Sort: {f.label}</option>
          ))}
        </select>

        <button
          onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
          aria-label={sortDir === 'asc' ? 'Sorting ascending, click for descending' : 'Sorting descending, click for ascending'}
          title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
          className={cn(
            'inline-flex items-center justify-center min-h-11 min-w-11 rounded-xl shrink-0',
            'border border-[var(--glass-border)] text-[var(--glass-muted)]',
            'hover:bg-black/[0.04] hover:text-[var(--glass-ink)] transition-colors',
          )}
        >
          {sortDir === 'asc'
            ? <ArrowUp className="w-4 h-4" aria-hidden="true" />
            : <ArrowDown className="w-4 h-4" aria-hidden="true" />}
        </button>

        <CsvExportButton rows={sortedRows} columns={JOB_SEPARATION_EXPORT_COLUMNS} filename="job-separation" />

        {canManage && (
          <button
            onClick={() => setManagingParties(true)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 min-h-11 px-3 rounded-xl shrink-0',
              'text-sm font-medium border border-[var(--glass-border)] text-[var(--glass-muted)]',
              'hover:bg-black/[0.04] hover:text-[var(--glass-ink)] transition-colors',
            )}
          >
            <Users className="w-4 h-4" aria-hidden="true" />
            Parties
          </button>
        )}

        {canManage && (
          <button
            onClick={() => { setDuplicateSource(null); setAdding(true); }}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 min-h-11 px-4 rounded-xl',
              'text-sm font-medium bg-brand-primary text-white hover:bg-brand-primary/90 transition-colors',
            )}
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            Add row
          </button>
        )}
      </div>

      {!loading && sortedRows.length > 0 && (
        <p className="text-sm text-[var(--glass-muted)]">
          <strong className="text-[var(--glass-ink)]">{sortedRows.length}</strong>
          {hasMore && '+'}
          {' '}{sortedRows.length === 1 ? 'row' : 'rows'}
          {search && ' matching your search'}
          {range !== 'all' && (
            <>{' '}in {DATE_RANGE_OPTIONS.find((r) => r.value === range)?.label.toLowerCase()}</>
          )}
          {hasMore && (
            <>{' '}— more match below; sort and CSV export cover only what&rsquo;s loaded, use &ldquo;Load more&rdquo; or narrow the search to reach the rest</>
          )}
        </p>
      )}

      {loading ? (
        <>
          {/* Phone: card skeleton */}
          <div className="sm:hidden space-y-2" aria-hidden="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 rounded-xl bg-black/[0.04]" />
            ))}
          </div>
          {/* Desk: table skeleton */}
          <div className="hidden sm:block rounded-xl glass overflow-hidden">
            <div className="table-scroll-wrapper max-h-[70vh] overflow-y-auto">
              <table className="w-full min-w-[1400px] border-collapse text-sm">
                <thead>
                  <tr>
                    {JOB_SEPARATION_COLUMNS.map((col) => (
                      <th key={col} scope="col" className={cn(
                        'sticky top-0 z-10 px-3 py-2.5 text-left text-[11px] font-semibold text-[var(--glass-muted)]',
                        'uppercase tracking-[0.06em] whitespace-nowrap bg-[var(--glass-bg-strong)] backdrop-blur-[14px]',
                        'border-b border-white/12',
                        col === 'Actions' && 'text-right',
                      )}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <SkeletonRows rows={5} cols={JOB_SEPARATION_COLS} />
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : sortedRows.length === 0 ? (
        <EmptyState hasSearch={Boolean(search)} range={range} />
      ) : (
        <>
          {/* Phone: card list */}
          <ul className="sm:hidden space-y-3">
            {sortedRows.map((row) => {
              const isRepeat = (row.aw_send_to ?? '').trim().toUpperCase() === 'REPEAT';
              return (
                <li key={row.id} className="glass rounded-xl p-4">
                  <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                    <div className="min-w-0 flex-1">
                      {/* Identity: sr. no, unit, JC status, and an AW-repeat flag */}
                      <div className="flex flex-wrap items-center gap-2">
                        {row.sr_no && (
                          <span className="font-mono text-xs font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                            {row.sr_no}
                          </span>
                        )}
                        {row.unit && (
                          <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                            Unit {row.unit}
                          </span>
                        )}
                        {row.jc_status && (
                          <span className={cn(
                            'text-[11px] font-medium px-1.5 py-0.5 rounded border',
                            row.jc_status.trim().toUpperCase() === 'DONE'
                              ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                              : 'bg-amber-100 text-amber-800 border-amber-200',
                          )}>
                            JC {row.jc_status}
                          </span>
                        )}
                        {isRepeat && (
                          <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-200">
                            AW REPEAT
                          </span>
                        )}
                      </div>

                      <p className="text-sm font-semibold text-[var(--glass-ink)] mt-1.5 break-words">
                        {row.party}
                      </p>
                      {row.material_name && (
                        <p className="text-xs text-[var(--glass-muted)] mt-0.5 break-words">
                          {row.material_name}
                        </p>
                      )}

                      {/* Specs: one labeled cell per field, aligned in a grid instead
                          of a wrapping inline list — each value gets its own space. */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3 mt-3 pt-3 border-t border-black/[0.06]">
                        <SpecField label="PO No" value={row.po_no} mono />
                        <SpecField label="PO Date" value={formatNumericDate(row.po_date)} mono />
                        <SpecField label="PM Code" value={row.pm_code} mono />
                        <SpecField label="Quantity" value={row.quantity !== null ? formatQty(row.quantity) : null} mono />
                        <SpecField label="Rate" value={formatMoney(row.rate)} mono />
                        <SpecField label="Order Value" value={formatMoney(row.order_value)} mono />
                        <SpecField label="Job Status" value={row.job_status} />
                        <SpecField label="Added" value={formatNumericDate(row.created_at)} mono />
                      </div>
                    </div>

                    {canManage && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => { setConfirming(null); setEditing(row); }}
                          aria-label={`Edit job separation row for ${row.party}`}
                          className={cn(
                            'inline-flex items-center justify-center gap-1.5 min-h-11 px-3 rounded-lg',
                            'text-xs font-medium border border-black/[0.12] text-[var(--glass-muted)]',
                            'hover:bg-black/[0.04] hover:text-[var(--glass-ink)] transition-colors',
                          )}
                        >
                          <Pencil className="w-4 h-4" aria-hidden="true" />
                          Edit
                        </button>

                        <button
                          onClick={() =>
                            confirming === row.id ? remove(row) : setConfirming(row.id)
                          }
                          onBlur={() => setConfirming((id) => (id === row.id ? null : id))}
                          disabled={busyId === row.id}
                          aria-label={
                            confirming === row.id
                              ? `Confirm deleting the job separation row for ${row.party}`
                              : `Delete the job separation row for ${row.party}`
                          }
                          className={cn(
                            'inline-flex items-center justify-center gap-1.5 min-h-11 px-3 rounded-lg',
                            'text-xs font-medium border transition-colors disabled:opacity-50 whitespace-nowrap',
                            confirming === row.id
                              ? 'border-red-300 bg-red-100 text-red-800 hover:bg-red-200'
                              : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100',
                          )}
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                          {busyId === row.id
                            ? 'Deleting…'
                            : confirming === row.id ? 'Confirm' : 'Delete'}
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Desk: table with a fixed header, scrolling through the rows —
              the spreadsheet reading this worksheet was modeled on. */}
          <div className="hidden sm:block rounded-xl glass overflow-hidden">
            <div className="table-scroll-wrapper max-h-[70vh] overflow-y-auto">
              <table className="w-full min-w-[1400px] border-collapse text-sm">
                <thead>
                  <tr>
                    {JOB_SEPARATION_COLUMNS.map((col) => (
                      <th key={col} scope="col" className={cn(
                        'sticky top-0 z-10 px-3 py-2.5 text-left text-[11px] font-semibold text-[var(--glass-muted)]',
                        'uppercase tracking-[0.06em] whitespace-nowrap bg-[var(--glass-bg-strong)] backdrop-blur-[14px]',
                        'border-b border-white/12',
                        col === 'Actions' && 'text-right',
                      )}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row) => {
                    const isRepeat = (row.aw_send_to ?? '').trim().toUpperCase() === 'REPEAT';
                    return (
                      <tr key={row.id} className="border-b border-white/8 hover:bg-black/[0.03] transition-colors">
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {canManage ? (
                            <button
                              type="button"
                              onClick={() => { setConfirming(null); setEditing(row); }}
                              aria-label={`Open details for ${row.party}`}
                              title="Open details"
                              className="font-mono text-xs font-semibold text-[var(--glass-ink)] underline decoration-dotted decoration-[var(--glass-muted)] underline-offset-2 hover:text-emerald-700 hover:decoration-emerald-700 transition-colors"
                            >
                              {row.sr_no || '—'}
                            </button>
                          ) : (
                            <span className="font-mono text-xs font-semibold text-[var(--glass-ink)]">{row.sr_no || '—'}</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-[var(--glass-ink)] whitespace-nowrap">{row.party}</td>
                        <td className="px-3 py-2.5 font-mono whitespace-nowrap">{row.po_no || '—'}</td>
                        <td className="px-3 py-2.5 font-mono whitespace-nowrap">{formatNumericDate(row.po_date) || '—'}</td>
                        <td className="px-3 py-2.5 min-w-[220px] max-w-[320px] whitespace-normal align-top">
                          <p className="font-mono text-xs font-semibold text-[var(--glass-ink)]">{row.pm_code || '—'}</p>
                          <p className="text-xs text-[var(--glass-muted)] mt-0.5 break-words">{row.material_name || '—'}</p>
                        </td>
                        <td className="px-3 py-2.5 font-mono whitespace-nowrap">{row.quantity !== null ? formatQty(row.quantity) : '—'}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{row.unit || '—'}</td>
                        <td className="px-3 py-2.5 font-mono whitespace-nowrap">{formatMoney(row.rate) ?? '—'}</td>
                        <td className="px-3 py-2.5 font-mono whitespace-nowrap">{formatMoney(row.order_value) ?? '—'}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{row.job_status || '—'}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {row.jc_status ? (
                            <span className={cn(
                              'text-[11px] font-medium px-1.5 py-0.5 rounded border',
                              row.jc_status.trim().toUpperCase() === 'DONE'
                                ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                                : 'bg-amber-100 text-amber-800 border-amber-200',
                            )}>
                              {row.jc_status}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {isRepeat ? (
                            <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-200">
                              AW REPEAT
                            </span>
                          ) : (row.aw_send_to || '—')}
                        </td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          {canManage && (
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                onClick={() => { setConfirming(null); setEditing(null); setDuplicateSource(row); setAdding(true); }}
                                aria-label={`Duplicate the job separation row for ${row.party}`}
                                title="Duplicate"
                                className={cn(
                                  'inline-flex items-center justify-center min-h-11 min-w-11 rounded-lg',
                                  'border border-black/[0.12] text-[var(--glass-muted)]',
                                  'hover:bg-black/[0.04] hover:text-[var(--glass-ink)] transition-colors',
                                )}
                              >
                                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>

                              {confirming === row.id ? (
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    onClick={() => remove(row)}
                                    disabled={busyId === row.id}
                                    onBlur={() => setConfirming((id) => (id === row.id ? null : id))}
                                    aria-label={`Confirm deleting the job separation row for ${row.party}`}
                                    className="inline-flex items-center justify-center min-h-11 px-2.5 rounded-lg text-[11px] font-medium border border-red-300 bg-red-100 text-red-800 hover:bg-red-200 disabled:opacity-50 transition-colors whitespace-nowrap"
                                  >
                                    {busyId === row.id ? '…' : 'Confirm'}
                                  </button>
                                  <button
                                    onClick={() => setConfirming(null)}
                                    disabled={busyId === row.id}
                                    className="inline-flex items-center justify-center min-h-11 px-1.5 text-[11px] font-medium text-[var(--glass-muted)] hover:text-[var(--glass-ink)] disabled:opacity-40 transition-colors"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setConfirming(row.id)}
                                  aria-label={`Delete the job separation row for ${row.party}`}
                                  title="Delete"
                                  className={cn(
                                    'inline-flex items-center justify-center min-h-11 min-w-11 rounded-lg',
                                    'border border-black/[0.12] text-[var(--glass-muted)]',
                                    'hover:bg-red-50 hover:border-red-200 hover:text-red-800 transition-colors',
                                  )}
                                >
                                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                              )}
                            </div>
                          )}
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
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className={cn(
                  'inline-flex items-center justify-center gap-1.5 min-h-11 px-4 rounded-xl',
                  'text-sm font-medium border border-[var(--glass-border)] text-[var(--glass-muted)]',
                  'hover:bg-black/[0.04] hover:text-[var(--glass-ink)] transition-colors disabled:opacity-50',
                )}
              >
                {loadingMore ? 'Loading…' : `Load ${PAGE_SIZE} more rows`}
              </button>
            </div>
          )}
        </>
      )}

      {(adding || editing) && (
        <AddJobSeparationModal
          editing={editing ?? undefined}
          prefill={!editing ? duplicateSource ?? undefined : undefined}
          onClose={() => { setAdding(false); setEditing(null); setDuplicateSource(null); }}
          onSaved={() => { setAdding(false); setEditing(null); setDuplicateSource(null); load(); }}
        />
      )}

      {managingParties && (
        <ManagePartiesModal onClose={() => setManagingParties(false)} />
      )}
    </div>
  );
}

function SpecField({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  if (!value || value === '—') return null;
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium text-[var(--glass-muted)] uppercase tracking-wide">
        {label}
      </p>
      <p className={cn('text-sm text-[var(--glass-ink)] font-semibold mt-0.5 truncate', mono && 'font-mono')}>
        {value}
      </p>
    </div>
  );
}

function EmptyState({ hasSearch, range }: { hasSearch: boolean; range: DateRangeOption }) {
  const scope = range === 'all' ? '' : ` in ${DATE_RANGE_OPTIONS.find((r) => r.value === range)?.label.toLowerCase()}`;
  return (
    <div className="flex flex-col items-center justify-center text-center rounded-xl border border-black/[0.08] bg-white px-4 py-12">
      <SplitSquareHorizontal className="w-6 h-6 text-[var(--glass-muted)]" aria-hidden="true" />
      <p className="text-sm font-medium text-[var(--glass-ink)] mt-3">
        {hasSearch ? `No row matches that search${scope}.` : `No job separation rows${scope}.`}
      </p>
      <p className="text-xs text-[var(--glass-muted)] mt-1 max-w-[42ch]">
        {hasSearch
          ? 'Try the sr. no, party, PO no, PM code or material name — or widen the date range above.'
          : range === 'all'
            ? 'Prepress adds a row here as each PO is split into job entries.'
            : 'Try "All data" if you expected to see older rows here.'}
      </p>
    </div>
  );
}
