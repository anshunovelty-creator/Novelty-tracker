'use client';
// src/components/admin/JobSeparationManager.tsx
// The live Job Separation worksheet — every PO line item Prepress has split
// out, searchable by sr. no, party, PO no, PM code or material.
//
// Read-only for most departments; Prepress and Admin own the entries. The
// list polls quietly in the background (see the effect below) so a row
// someone else just added shows up without a manual refresh — the same
// visibility-aware pattern the room displays use, not Supabase Realtime.

import { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Search, Plus, Pencil, Copy, Ban, SplitSquareHorizontal, ArrowUp, ArrowDown, Users, FilePlus2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, formatQty, formatNumericDate, formatJobCardNumber } from '@/lib/utils';
import { csvDate, csvTimestamp, type CsvColumn } from '@/lib/export/csv';
import type { JobSeparation, AddJobFormData, Job } from '@/lib/types';
import type { Department } from '@/lib/constants/departments';
import AddJobSeparationModal from './AddJobSeparationModal';
import AddJobForm from './AddJobForm';
import { PromptModal } from './modals';
import ManagePartiesModal from './ManagePartiesModal';
import PrepressTodoPanel from './PrepressTodoPanel';
import CsvExportButton from './CsvExportButton';
import { SkeletonRows } from '@/components/ui/Skeleton';

// party/po_no/po_date/pm_code/quantity map cleanly onto Job fields;
// material_name maps to job_name (confirmed with the team — the two are
// treated as the same product/label name here). Delivery Date and Job Type
// have no Job Separation source, so they're left for the team to fill in
// after reviewing the prefilled form.
function jobPrefillFromRow(row: JobSeparation): Partial<AddJobFormData> {
  return {
    party:      row.party,
    po_number:  row.po_no ?? '',
    po_date:    row.po_date ?? '',
    pm_code:    row.pm_code ?? '',
    job_name:   row.material_name ?? '',
    label_qty:  row.quantity,
  };
}

// Header labels for the desk table, one column per worksheet field plus
// actions. "Added" is deliberately left out here — it's in the CSV export
// but kept out of the table to hold off horizontal scroll on desktop.
// Must stay in the same order as the <td>s rendered below.
const JOB_SEPARATION_COLUMNS = [
  'Sr No', 'Party', 'PO No / Date', 'PM Code / Material', 'Qty / Rate', 'Unit',
  'Order Value', 'Job Status', 'JC Status', 'AW', 'Actions',
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

// A stable reference for "no data yet" — `data?.rows ?? []` would otherwise
// hand back a fresh array every render, defeating the sortedRows useMemo.
const EMPTY_ROWS: JobSeparation[] = [];

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

// Which single SortField each table header sorts by. Merged headers (PO No /
// Date, PM Code / Material, Qty / Rate) stay one plain clickable label —
// clicking sorts by the more useful of the two fields (date over number,
// code over free-text name, quantity over rate) rather than offering a
// per-field choice, which read as clutter with two tiny buttons stacked in
// one header cell.
const COLUMN_SORT_FIELDS: Partial<Record<typeof JOB_SEPARATION_COLUMNS[number], SortField>> = {
  'Sr No':               'sr_no',
  'Party':                'party',
  'PO No / Date':         'po_date',
  'PM Code / Material':   'pm_code',
  'Qty / Rate':           'quantity',
  'Unit':                 'unit',
  'Order Value':          'order_value',
  'Job Status':           'job_status',
  'JC Status':            'jc_status',
  'AW':                   'aw_send_to',
};

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
  return value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
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

type Props = { canManage: boolean; dept: Department | null };

export default function JobSeparationManager({ canManage, dept }: Props) {
  const [search,      setSearch]      = useState('');
  const [searchField, setSearchField] = useState('all');
  const [range,       setRange]       = useState<DateRangeOption>('month');
  const [sortField,   setSortField]   = useState<SortField>('created_at');
  const [sortDir,     setSortDir]     = useState<SortDir>('desc');

  // Click a header to sort by it; click the same one again to flip direction —
  // replaces the old field-dropdown + direction-button pair.
  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };
  const [adding,      setAdding]      = useState(false);
  const [editing,     setEditing]     = useState<JobSeparation | null>(null);
  // Set when "Duplicate" is used instead of "Add row" — seeds the add form
  // with this row's fields (a fresh POST, not a PATCH to this row).
  const [duplicateSource, setDuplicateSource] = useState<JobSeparation | null>(null);
  // Set when "Add Job" is used on a row — opens AddJobForm prefilled,
  // submitting to that row's create-job endpoint instead of a fresh POST.
  const [addingJobFrom, setAddingJobFrom] = useState<JobSeparation | null>(null);
  // The row a Cancel Job prompt is open for — cancelling always asks for a
  // reason, never a bare confirm, since it can't be undone afterward.
  const [cancellingRow, setCancellingRow] = useState<JobSeparation | null>(null);
  const [busyId,        setBusyId]        = useState<string | null>(null);
  const [managingParties, setManagingParties] = useState(false);
  const [limit,       setLimit]       = useState(PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);

  const queryClient = useQueryClient();

  // Debounced only while typing — range/field changes apply immediately.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [search]);

  // A new search/field/range starts back at page one — the limit a previous
  // "Load more" click reached doesn't carry over to an unrelated query.
  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [debouncedSearch, searchField, range]);

  // "Load more" just grows `limit` and re-fetches the whole 0..limit range
  // (the API has no real cursor), so it's one more dimension of the query
  // key rather than a separate pagination mechanism.
  const rowsQuery = useQuery({
    queryKey: ['job-separations', debouncedSearch, searchField, range, limit],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('range', range);
      params.set('limit', String(limit));
      if (debouncedSearch) {
        params.set('search', debouncedSearch);
        if (searchField !== 'all') params.set('field', searchField);
      }
      const res  = await fetch(`/api/job-separations?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load job separation rows');
      return {
        rows:    (data.job_separations ?? []) as JobSeparation[],
        hasMore: Boolean(data.hasMore),
      };
    },
    placeholderData: keepPreviousData,
    // Quiet background refresh — refetchInterval already skips firing while
    // the tab isn't visible, matching the old manual visibilitychange logic.
    refetchInterval: POLL_MS,
  });
  const rows    = rowsQuery.data?.rows ?? EMPTY_ROWS;
  const hasMore = rowsQuery.data?.hasMore ?? false;
  const loading = rowsQuery.isLoading;

  useEffect(() => {
    if (!rowsQuery.isFetching) setLoadingMore(false);
  }, [rowsQuery.isFetching]);

  // Only the very first fetch this component ever makes gets a toast on
  // failure — a filter change, "Load more", or a background poll failing
  // quietly just leaves the current rows on screen, same as before.
  const firstLoadRef = useRef(true);
  useEffect(() => {
    if (rowsQuery.isError && firstLoadRef.current) {
      toast.error((rowsQuery.error as Error)?.message ?? 'Failed to load job separation rows');
    }
    if (rowsQuery.isSuccess || rowsQuery.isError) firstLoadRef.current = false;
  }, [rowsQuery.isSuccess, rowsQuery.isError, rowsQuery.error]);

  function loadMore() {
    setLoadingMore(true);
    setLimit((l) => l + PAGE_SIZE);
  }

  // Stamps the row locally so the button flips to "Job added" without a
  // refetch — the server already did the same write via the create-job
  // route's linked_job_id update.
  function handleJobAdded(row: JobSeparation, job: Job) {
    queryClient.setQueriesData<{ rows: JobSeparation[]; hasMore: boolean }>(
      { queryKey: ['job-separations'] },
      (old) => old
        ? {
            ...old,
            rows: old.rows.map((r) =>
              r.id === row.id
                ? { ...r, linked_job_id: job.id, linked_job_card_number: job.job_card_number }
                : r
            ),
          }
        : old
    );
    setAddingJobFrom(null);
  }

  const sortedRows = useMemo(
    () => sortRows(rows, sortField, sortDir),
    [rows, sortField, sortDir],
  );

  // Live sum of what's currently on screen — reacts to search, date range
  // and "Load more" the same way the row count above the table does.
  // Cancelled rows don't count: that order isn't being produced or billed.
  const totalOrderValue = useMemo(
    () => sortedRows.reduce(
      (sum, r) => r.cancelled_at ? sum : sum + (r.order_value ?? 0),
      0,
    ),
    [sortedRows],
  );

  async function cancelRow(row: JobSeparation, reason: string) {
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/job-separations/${row.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to cancel row');
        return;
      }
      queryClient.setQueriesData<{ rows: JobSeparation[]; hasMore: boolean }>(
        { queryKey: ['job-separations'] },
        (old) => old
          ? { ...old, rows: old.rows.map((r) => (r.id === row.id ? (data.job_separation as JobSeparation) : r)) }
          : old
      );
      toast.success('Job separation row cancelled');
    } catch {
      toast.error('Network error');
    } finally {
      setBusyId(null);
    }
  }

  // A whole header's plain label made clickable — click to sort by it,
  // click again to flip direction. Looks exactly like the old static header
  // (same text, no permanent icon) except for the active column, which gets
  // a small arrow. Merged headers (PO No / Date, PM Code / Material, Qty /
  // Rate) keep their single combined label and sort by the one field
  // COLUMN_SORT_FIELDS picks for them — no per-field sub-buttons.
  function sortLabel(label: string, field: SortField) {
    const active = sortField === field;
    return (
      <button
        type="button"
        onClick={() => handleSort(field)}
        aria-label={`Sort by ${label}${active ? `, currently ${sortDir === 'asc' ? 'ascending' : 'descending'}` : ''}`}
        className={cn(
          'inline-flex items-center gap-1 hover:text-[var(--glass-ink)] transition-colors',
          active && 'text-[var(--glass-ink)]',
        )}
      >
        {label}
        {active && (
          sortDir === 'asc'
            ? <ArrowUp className="w-3 h-3 shrink-0" aria-hidden="true" />
            : <ArrowDown className="w-3 h-3 shrink-0" aria-hidden="true" />
        )}
      </button>
    );
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
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
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

          {canManage && (
            <p
              className="text-sm font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1"
              title={hasMore ? 'Totals only what’s loaded — narrow the search or "Load more" to cover the rest' : 'Total order value of the rows shown above, excluding cancelled rows'}
            >
              Total order value: ₹{formatMoney(totalOrderValue)}
              {hasMore && <span className="text-emerald-700">*</span>}
            </p>
          )}
        </div>
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
              <table className="w-full min-w-[980px] border-collapse text-sm">
                <thead>
                  <tr>
                    {JOB_SEPARATION_COLUMNS.map((col) => (
                      <th key={col} scope="col" className={cn(
                        'sticky top-0 z-10 px-3 py-1.5 text-left text-[11px] font-semibold text-[var(--glass-muted)]',
                        'uppercase tracking-[0.06em] whitespace-nowrap bg-[var(--glass-bg-strong)] backdrop-blur-[14px]',
                        'border-b border-white/12',
                        col === 'Actions' && 'text-right',
                        // Sr No is the team's floor reference number — keep it pinned to the
                        // left edge through both scroll axes so it's always visible. z-20
                        // (above the plain top-sticky headers at z-10) so it stays on top at
                        // the corner where both stickies overlap.
                        col === 'Sr No' && 'left-0 z-20 border-r border-white/12',
                        // The header label's own nowrap width was the real floor keeping
                        // this column from shrinking — a td-only width doesn't constrain a
                        // table column if its header cell is wider. Match the body cell's
                        // width here too, and let the label wrap instead of forcing nowrap.
                        // min-w-0 overrides the table's default per-column floor, which
                        // Chrome derives from the longest unbreakable "word" in any row's
                        // material name and otherwise ignores the explicit width above.
                        col === 'PM Code / Material' && 'w-[200px] min-w-0 whitespace-normal',
                        // A thin vertical rule between every column but the last —
                        // Sr No already gets its own (slightly stronger) divider from
                        // the sticky styling above, so it's excluded here to avoid a
                        // doubled-up border.
                        col !== 'Actions' && col !== 'Sr No' && 'border-r border-white/8',
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
              const isCancelled = Boolean(row.cancelled_at);
              return (
                <li key={row.id} className={cn('glass rounded-xl p-4', isCancelled && 'border border-red-300/40')}>
                  <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                    <div className={cn('min-w-0 flex-1', isCancelled && 'text-red-600 line-through decoration-red-400')}>
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
                        {isCancelled && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded bg-red-600 text-white no-underline">
                            <Ban className="w-3 h-3" aria-hidden="true" />
                            CANCELLED
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
                      {isCancelled && (
                        <p className="text-xs font-medium text-red-600 no-underline mt-1 break-words">
                          Reason: {row.cancel_reason}
                          {row.cancelled_by && <> — cancelled by {row.cancelled_by}</>}
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

                    {canManage && !isCancelled && (
                      <div className="flex items-center gap-2 shrink-0 flex-wrap">
                        <button
                          onClick={() => setEditing(row)}
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

                        {dept && (row.linked_job_id ? (
                          <Link
                            href={`/admin/jobs/${row.linked_job_id}`}
                            className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 transition-colors whitespace-nowrap"
                            title="Open this Job"
                          >
                            <FilePlus2 className="w-4 h-4" aria-hidden="true" />
                            Job {formatJobCardNumber(row.linked_job_card_number) || 'added'}
                          </Link>
                        ) : (
                          <button
                            onClick={() => setAddingJobFrom(row)}
                            aria-label={`Add a Job from the job separation row for ${row.party}`}
                            className={cn(
                              'inline-flex items-center justify-center gap-1.5 min-h-11 px-3 rounded-lg',
                              'text-xs font-medium border border-black/[0.12] text-[var(--glass-muted)]',
                              'hover:bg-black/[0.04] hover:text-[var(--glass-ink)] transition-colors',
                            )}
                          >
                            <FilePlus2 className="w-4 h-4" aria-hidden="true" />
                            Add Job
                          </button>
                        ))}

                        <button
                          onClick={() => setCancellingRow(row)}
                          disabled={busyId === row.id}
                          aria-label={`Cancel the job separation row for ${row.party}`}
                          className={cn(
                            'inline-flex items-center justify-center gap-1.5 min-h-11 px-3 rounded-lg',
                            'text-xs font-medium border transition-colors disabled:opacity-50 whitespace-nowrap',
                            'border-red-200 bg-red-50 text-red-700 hover:bg-red-100',
                          )}
                        >
                          <Ban className="w-4 h-4" aria-hidden="true" />
                          {busyId === row.id ? 'Cancelling…' : 'Cancel Job'}
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
              <table className="w-full min-w-[980px] border-collapse text-sm">
                <thead>
                  <tr>
                    {JOB_SEPARATION_COLUMNS.map((col) => (
                      <th key={col} scope="col" className={cn(
                        'sticky top-0 z-10 px-3 py-1.5 text-left text-[11px] font-semibold text-[var(--glass-muted)]',
                        'uppercase tracking-[0.06em] whitespace-nowrap bg-[var(--glass-bg-strong)] backdrop-blur-[14px]',
                        'border-b border-white/12',
                        col === 'Actions' && 'text-right',
                        // Sr No is the team's floor reference number — keep it pinned to the
                        // left edge through both scroll axes so it's always visible. z-20
                        // (above the plain top-sticky headers at z-10) so it stays on top at
                        // the corner where both stickies overlap.
                        col === 'Sr No' && 'left-0 z-20 border-r border-white/12',
                        // The header label's own nowrap width was the real floor keeping
                        // this column from shrinking — a td-only width doesn't constrain a
                        // table column if its header cell is wider. Match the body cell's
                        // width here too, and let the label wrap instead of forcing nowrap.
                        // min-w-0 overrides the table's default per-column floor, which
                        // Chrome derives from the longest unbreakable "word" in any row's
                        // material name and otherwise ignores the explicit width above.
                        col === 'PM Code / Material' && 'w-[200px] min-w-0 whitespace-normal',
                        // A thin vertical rule between every column but the last —
                        // Sr No already gets its own (slightly stronger) divider from
                        // the sticky styling above, so it's excluded here to avoid a
                        // doubled-up border.
                        col !== 'Actions' && col !== 'Sr No' && 'border-r border-white/8',
                      )}>
                        {COLUMN_SORT_FIELDS[col] ? sortLabel(col, COLUMN_SORT_FIELDS[col]!) : col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row, i) => {
                    const isRepeat = (row.aw_send_to ?? '').trim().toUpperCase() === 'REPEAT';
                    const isCancelled = Boolean(row.cancelled_at);
                    return (
                      <tr
                        key={row.id}
                        className={cn(
                          'border-b border-white/8 transition-colors',
                          i % 2 === 1 && 'bg-[var(--glass-bg)]',
                          isCancelled
                            ? 'text-red-600 line-through decoration-red-400'
                            : 'hover:bg-black/[0.03]',
                        )}
                      >
                        <td className="sticky left-0 z-10 px-3 py-1.5 whitespace-nowrap bg-[var(--glass-bg-strong)] backdrop-blur-[14px] border-r border-white/8">
                          {canManage && !isCancelled ? (
                            <button
                              type="button"
                              onClick={() => setEditing(row)}
                              aria-label={`Open details for ${row.party}`}
                              title="Open details"
                              className="font-mono text-xs font-semibold text-[var(--glass-ink)] underline decoration-dotted decoration-[var(--glass-muted)] underline-offset-2 hover:text-emerald-700 hover:decoration-emerald-700 transition-colors"
                            >
                              {row.sr_no || '—'}
                            </button>
                          ) : (
                            <span className={cn('font-mono text-xs font-semibold', !isCancelled && 'text-[var(--glass-ink)]')}>{row.sr_no || '—'}</span>
                          )}
                        </td>
                        <td className={cn('px-3 py-1.5 font-semibold whitespace-normal break-words min-w-[110px] border-r border-white/8', !isCancelled && 'text-[var(--glass-ink)]')}>
                          {row.party}
                          {isCancelled && (
                            <p className="text-[11px] font-medium no-underline mt-0.5">
                              CANCELLED — {row.cancel_reason}
                              {row.cancelled_by && <> (by {row.cancelled_by})</>}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-1.5 whitespace-nowrap align-top border-r border-white/8">
                          <p className={cn('font-mono text-xs font-semibold', !isCancelled && 'text-[var(--glass-ink)]')}>{row.po_no || '—'}</p>
                          <p className={cn('text-xs mt-0.5', !isCancelled && 'text-[var(--glass-muted)]')}>{formatNumericDate(row.po_date) || '—'}</p>
                        </td>
                        <td className="px-3 py-1.5 w-[200px] min-w-0 whitespace-normal align-top border-r border-white/8">
                          <p className={cn('font-mono text-xs font-semibold', !isCancelled && 'text-[var(--glass-ink)]')}>{row.pm_code || '—'}</p>
                          <p className={cn('text-xs mt-0.5 break-words', !isCancelled && 'text-[var(--glass-muted)]')}>{row.material_name || '—'}</p>
                        </td>
                        <td className="px-3 py-1.5 whitespace-nowrap align-top border-r border-white/8">
                          <p className={cn('font-mono text-xs font-semibold', !isCancelled && 'text-[var(--glass-ink)]')}>{row.quantity !== null ? formatQty(row.quantity) : '—'}</p>
                          <p className={cn('font-mono text-xs mt-0.5', !isCancelled && 'text-[var(--glass-muted)]')}>@ {formatMoney(row.rate) ?? '—'}</p>
                        </td>
                        <td className="px-3 py-1.5 whitespace-nowrap border-r border-white/8">{row.unit || '—'}</td>
                        <td className="px-3 py-1.5 font-mono whitespace-nowrap border-r border-white/8">{formatMoney(row.order_value) ?? '—'}</td>
                        <td className="px-3 py-1.5 whitespace-normal break-words min-w-[90px] border-r border-white/8">
                          {row.job_status ? (
                            <span className="inline-block text-[11px] font-medium px-1.5 py-0.5 rounded border no-underline bg-sky-100 text-sky-800 border-sky-200">
                              {row.job_status}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-1.5 whitespace-nowrap border-r border-white/8">
                          {row.jc_status ? (
                            <span className={cn(
                              'text-[11px] font-medium px-1.5 py-0.5 rounded border no-underline',
                              row.jc_status.trim().toUpperCase() === 'DONE'
                                ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                                : 'bg-amber-100 text-amber-800 border-amber-200',
                            )}>
                              {row.jc_status}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-1.5 whitespace-normal break-words min-w-[90px] border-r border-white/8">
                          {isRepeat ? (
                            <span className="inline-block whitespace-nowrap text-[11px] font-medium px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-200 no-underline">
                              AW REPEAT
                            </span>
                          ) : (row.aw_send_to || '—')}
                        </td>
                        <td className="px-3 py-1.5 text-right whitespace-nowrap">
                          {isCancelled ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg bg-red-600 text-white no-underline">
                              <Ban className="w-3.5 h-3.5" aria-hidden="true" />
                              Cancelled
                            </span>
                          ) : canManage && (
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                onClick={() => { setEditing(null); setDuplicateSource(row); setAdding(true); }}
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

                              {dept && (row.linked_job_id ? (
                                <Link
                                  href={`/admin/jobs/${row.linked_job_id}`}
                                  className="inline-flex items-center justify-center min-h-11 px-2.5 rounded-lg text-[11px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 transition-colors whitespace-nowrap"
                                  title="Open this Job"
                                >
                                  Job {formatJobCardNumber(row.linked_job_card_number) || 'added'}
                                </Link>
                              ) : (
                                <button
                                  onClick={() => setAddingJobFrom(row)}
                                  aria-label={`Add a Job from the job separation row for ${row.party}`}
                                  title="Add Job"
                                  className={cn(
                                    'inline-flex items-center justify-center min-h-11 min-w-11 rounded-lg',
                                    'border border-black/[0.12] text-[var(--glass-muted)]',
                                    'hover:bg-black/[0.04] hover:text-[var(--glass-ink)] transition-colors',
                                  )}
                                >
                                  <FilePlus2 className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                              ))}

                              <button
                                onClick={() => setCancellingRow(row)}
                                disabled={busyId === row.id}
                                aria-label={`Cancel the job separation row for ${row.party}`}
                                title="Cancel Job"
                                className={cn(
                                  'inline-flex items-center justify-center min-h-11 min-w-11 rounded-lg',
                                  'border border-black/[0.12] text-[var(--glass-muted)] disabled:opacity-50',
                                  'hover:bg-red-50 hover:border-red-200 hover:text-red-800 transition-colors',
                                )}
                              >
                                <Ban className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
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
          onSaved={() => {
            setAdding(false);
            setEditing(null);
            setDuplicateSource(null);
            queryClient.invalidateQueries({ queryKey: ['job-separations'] });
          }}
        />
      )}

      {managingParties && (
        <ManagePartiesModal onClose={() => setManagingParties(false)} />
      )}

      {cancellingRow && (
        <PromptModal
          title={`Cancel job separation row ${cancellingRow.sr_no ?? ''}`.trim()}
          description="This can't be undone — the row stays visible, marked cancelled with this reason."
          label="Cancellation reason"
          kind="textarea"
          required
          confirmLabel="Cancel job"
          onCancel={() => setCancellingRow(null)}
          onConfirm={(reason) => {
            const row = cancellingRow;
            setCancellingRow(null);
            cancelRow(row, reason);
          }}
        />
      )}

      {addingJobFrom && dept && (
        <div
          className="fixed inset-0 z-50 flex items-start sm:items-center justify-center overflow-y-auto bg-black/40 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setAddingJobFrom(null); }}
        >
          <div className="w-full max-w-2xl my-8">
            <AddJobForm
              key={addingJobFrom.id}
              dept={dept}
              prefillData={jobPrefillFromRow(addingJobFrom)}
              sourceJobSeparationId={addingJobFrom.id}
              onSuccess={(job) => handleJobAdded(addingJobFrom, job)}
              onCancel={() => setAddingJobFrom(null)}
            />
          </div>
        </div>
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
