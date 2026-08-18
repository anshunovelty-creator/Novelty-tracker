'use client';
// src/components/admin/DiesManager.tsx
// The die library. Every cutting die the shop owns, searchable by the job it
// was cut for, its material, corner style or the serial etched on it.
//
// Read-only for most departments — the point is answering "do we already have
// a die for this" before ordering another. Prepress and Admin own the entries.

import { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Search, Plus, Pencil, Trash2, Scissors, ArrowUp, ArrowDown } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, formatNumericDate } from '@/lib/utils';
import { csvDate, csvTimestamp, type CsvColumn } from '@/lib/export/csv';
import type { Die, DieStatus } from '@/lib/types';
import AddDieModal from './AddDieModal';
import CsvExportButton from './CsvExportButton';
import { SkeletonRows } from '@/components/ui/Skeleton';

// Header labels for the desk table — must stay in the same order as the
// <td>s rendered below.
const DIE_COLUMNS = [
  'Sr No', 'Status', 'Serial No', 'Job Name', 'Corner', 'Size', 'Cylinder', 'Material',
  'Location', 'Gap across', 'Ups / repeat', 'Received', 'Damage', 'Actions',
] as const;
const DIE_COLS = DIE_COLUMNS.length;

// Stable reference — `data ?? []` would create a new array every render,
// making the sortedDies useMemo below recompute even when data hasn't changed.
const EMPTY_DIES: Die[] = [];

// Click-to-sort, mirroring JobSeparationManager.tsx's approach. Size
// (length/width) and Damage (date/reason) are merged headers — each sorts
// by the more useful of its two source fields.
type SortField =
  | 'status' | 'serial_no' | 'job_name' | 'corner' | 'length' | 'cylinder'
  | 'material' | 'location' | 'gap' | 'ups' | 'die_received_on' | 'damage_date' | 'created_at';
type SortDir = 'asc' | 'desc';

const COLUMN_SORT_FIELDS: Partial<Record<typeof DIE_COLUMNS[number], SortField>> = {
  'Sr No':         'created_at',
  'Status':        'status',
  'Serial No':     'serial_no',
  'Job Name':      'job_name',
  'Corner':        'corner',
  'Size':          'length',
  'Cylinder':      'cylinder',
  'Material':      'material',
  'Location':      'location',
  'Gap across':    'gap',
  'Ups / repeat':  'ups',
  'Received':      'die_received_on',
  'Damage':        'damage_date',
};

const SORT_FIELD_KIND: Record<SortField, 'text' | 'number' | 'date'> = {
  status: 'text', serial_no: 'text', job_name: 'text', corner: 'text', length: 'text',
  cylinder: 'number', material: 'text', location: 'text', gap: 'text', ups: 'number',
  die_received_on: 'date', damage_date: 'date', created_at: 'date',
};

// Nulls always sort to the end regardless of direction — "not set" reads as
// "furthest away," in either direction.
function compareDies(a: Die, b: Die, field: SortField): number {
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

function sortDies(dies: Die[], field: SortField, dir: SortDir): Die[] {
  const sorted = [...dies];
  sorted.sort((a, b) => {
    const diff = compareDies(a, b, field);
    return dir === 'asc' ? diff : -diff;
  });
  return sorted;
}

const STATUS_BADGE: Record<DieStatus, string> = {
  'IN USE': 'bg-emerald-100 text-emerald-800 border border-emerald-200',
  'EXTRA':  'bg-amber-100 text-amber-800 border border-amber-200',
  'DAMAGE': 'bg-red-100 text-red-700 border border-red-200',
};

// Mirrors DIE_SEARCH_FIELDS in src/app/api/dies/route.ts — the value sent
// as ?field=. "All fields" (value 'all') skips the param, falling back to
// the server's multi-column OR search.
const DIE_SEARCH_FIELDS: { value: string; label: string; placeholder: string }[] = [
  { value: 'all',       label: 'All fields',    placeholder: 'Search job, material, corner, serial no or location' },
  { value: 'job_name',  label: 'Job name',      placeholder: 'Search by job name' },
  { value: 'serial_no', label: 'Serial no',     placeholder: 'Search by serial no' },
  { value: 'material',  label: 'Material',      placeholder: 'Search by material' },
  { value: 'corner',    label: 'Corner',        placeholder: 'Search by corner' },
  { value: 'location',  label: 'Location',      placeholder: 'Search by location' },
  { value: 'length',    label: 'Size (length)', placeholder: 'Search by length' },
  { value: 'width',     label: 'Size (width)',  placeholder: 'Search by width' },
  { value: 'cylinder',  label: 'Cylinder',      placeholder: 'Search by cylinder' },
  { value: 'gap',       label: 'Gap across',    placeholder: 'Search by gap across' },
  { value: 'ups',       label: 'Ups / repeat',  placeholder: 'Search by ups / repeat' },
];

// Sr No isn't a stored field — it's each die's rank by created_at among the
// currently loaded rows, recomputed on every render. That's what makes it
// "not fixed": delete a die from the middle and everything after it just
// shifts up, with no renumbering write of its own.
function buildSrNoMap(dies: Die[]): Map<string, number> {
  const byCreated = [...dies].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  return new Map(byCreated.map((d, i) => [d.id, i + 1]));
}

function buildDieExportColumns(srNoMap: Map<string, number>): CsvColumn<Die>[] {
  return [
  { header: 'Sr No',            value: (d) => srNoMap.get(d.id) ?? null },
  { header: 'Status',           value: (d) => d.status },
  { header: 'Serial No',        value: (d) => d.serial_no },
  { header: 'Job Name',         value: (d) => d.job_name },
  { header: 'Corner',           value: (d) => d.corner },
  { header: 'Length',           value: (d) => d.length },
  { header: 'Width',            value: (d) => d.width },
  { header: 'Cylinder',         value: (d) => d.cylinder },
  { header: 'Material',         value: (d) => d.material },
  { header: 'Ups',              value: (d) => d.ups },
  { header: 'Gap',              value: (d) => d.gap },
  { header: 'Location',         value: (d) => d.location },
  { header: 'Die Received On',  value: (d) => csvDate(d.die_received_on) },
  { header: 'Damage Date',      value: (d) => csvDate(d.damage_date) },
  { header: 'Damage Reason',    value: (d) => d.damage_reason },
  { header: 'Added',            value: (d) => csvTimestamp(d.created_at) },
  ];
}

export default function DiesManager({ canManage }: { canManage: boolean }) {
  const [search,      setSearch]      = useState('');
  const [searchField, setSearchField] = useState('all');
  const [sortField,   setSortField]   = useState<SortField>('created_at');
  const [sortDir,     setSortDir]     = useState<SortDir>('asc');
  const [adding,      setAdding]      = useState(false);
  const [editing,     setEditing]     = useState<Die | null>(null);
  // The row whose Delete has been armed. Deleting is two taps, never a dialog.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busyId,     setBusyId]     = useState<string | null>(null);

  // Click a header to sort by it; click the same one again to flip direction.
  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const queryClient = useQueryClient();

  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [search]);

  const diesQuery = useQuery({
    queryKey: ['dies', debouncedSearch, searchField],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedSearch) {
        params.set('search', debouncedSearch);
        if (searchField !== 'all') params.set('field', searchField);
      }
      const res  = await fetch(`/api/dies?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load dies');
      return (data.dies ?? []) as Die[];
    },
    placeholderData: keepPreviousData,
  });
  const dies    = diesQuery.data ?? EMPTY_DIES;
  const loading = diesQuery.isLoading;

  const sortedDies = useMemo(
    () => sortDies(dies, sortField, sortDir),
    [dies, sortField, sortDir]
  );

  const srNoMap = useMemo(() => buildSrNoMap(dies), [dies]);
  const exportColumns = useMemo(() => buildDieExportColumns(srNoMap), [srNoMap]);

  useEffect(() => {
    if (diesQuery.error) toast.error((diesQuery.error as Error).message);
  }, [diesQuery.error]);

  async function remove(die: Die) {
    setBusyId(die.id);
    try {
      const res = await fetch(`/api/dies/${die.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to delete die');
        return;
      }
      queryClient.setQueriesData<Die[]>(
        { queryKey: ['dies'] },
        (old) => old?.filter((d) => d.id !== die.id)
      );
      toast.success('Die deleted');
    } catch {
      toast.error('Network error');
    } finally {
      setBusyId(null);
      setConfirming(null);
    }
  }

  // A whole header's plain label made clickable — click to sort by it, click
  // again to flip direction. Merged headers (Size, Damage) keep their single
  // combined label and sort by the one field COLUMN_SORT_FIELDS picks.
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
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
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
          {DIE_SEARCH_FIELDS.map((f) => (
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
            placeholder={DIE_SEARCH_FIELDS.find((f) => f.value === searchField)?.placeholder}
            aria-label="Search dies"
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

        <CsvExportButton rows={dies} columns={exportColumns} filename="dies" />

        {canManage && (
          <button
            onClick={() => setAdding(true)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 min-h-11 px-4 rounded-xl',
              'text-sm font-medium bg-brand-primary text-white hover:bg-brand-primary/90 transition-colors',
            )}
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            Add die
          </button>
        )}
      </div>

      {!loading && dies.length > 0 && (
        <p className="text-sm text-[var(--glass-muted)]">
          <strong className="text-[var(--glass-ink)]">{dies.length}</strong>
          {' '}{dies.length === 1 ? 'die' : 'dies'}
          {search && ' matching your search'}
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
              <table className="w-full min-w-[1450px] border-collapse text-sm text-center">
                <thead>
                  <tr>
                    {DIE_COLUMNS.map((col) => (
                      <th key={col} scope="col" className={cn(
                        'sticky top-0 z-10 px-3 py-1.5 text-center text-[11px] font-semibold text-[var(--glass-muted)]',
                        'uppercase tracking-[0.06em] whitespace-nowrap bg-[var(--glass-bg-strong)] backdrop-blur-[14px]',
                        'border-b border-white/12',
                        col === 'Job Name' && 'w-[220px] min-w-0 whitespace-normal',
                        col === 'Sr No' && 'left-0 z-20 border-r border-white/12',
                      )}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <SkeletonRows rows={5} cols={DIE_COLS} />
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : dies.length === 0 ? (
        <EmptyState hasSearch={Boolean(search)} />
      ) : (
        <>
          {/* Phone: card list */}
          <ul className="sm:hidden space-y-3">
            {sortedDies.map((die) => {
              const isDamaged = die.status === 'DAMAGE';
              return (
              <li
                key={die.id}
                className={cn(
                  'rounded-xl p-4',
                  isDamaged
                    ? 'border border-red-200 bg-red-50 shadow-[0_1px_2px_rgba(12,42,32,0.04),0_2px_8px_rgba(12,42,32,0.05)]'
                    : 'glass',
                )}
              >
                <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                  <div className="min-w-0 flex-1">
                    {/* Identity: status, serial, corner style, job name */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn('text-[11px] font-medium px-1.5 py-0.5 rounded', STATUS_BADGE[die.status])}>
                        {die.status}
                      </span>
                      {die.serial_no && (
                        <span className="font-mono text-xs font-semibold text-[var(--glass-ink)]">
                          {die.serial_no.toUpperCase()}
                        </span>
                      )}
                      {die.corner && (
                        <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                          {die.corner}
                        </span>
                      )}
                    </div>

                    <p className="text-sm font-semibold text-[var(--glass-ink)] mt-1.5 break-words">
                      {die.job_name}
                    </p>

                    {/* Specs: one labeled cell per field, aligned in a grid instead
                        of a wrapping inline list — each value gets its own space. */}
                    <div className={cn(
                      'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3 mt-3 pt-3 border-t',
                      isDamaged ? 'border-red-200/70' : 'border-black/[0.06]',
                    )}>
                      <SpecField label="Size" value={sizeOf(die)} mono />
                      <SpecField label="Cylinder" value={die.cylinder?.toString()} mono />
                      <SpecField label="Material" value={die.material} />
                      <SpecField label="Location" value={die.location} />
                      <SpecField label="Gap across" value={die.gap} />
                      <SpecField label="Ups / repeat" value={die.ups?.toString()} mono />
                      <SpecField label="Received" value={formatNumericDate(die.die_received_on)} mono />
                    </div>

                    {isDamaged && (die.damage_date || die.damage_reason) && (
                      <p className="mt-3 text-xs font-medium text-red-800 break-words">
                        Damaged{die.damage_date && ` ${formatNumericDate(die.damage_date)}`}
                        {die.damage_reason && ` — ${die.damage_reason}`}
                      </p>
                    )}
                  </div>

                  {canManage && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => { setConfirming(null); setEditing(die); }}
                        aria-label={`Edit die for ${die.job_name}`}
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
                          confirming === die.id ? remove(die) : setConfirming(die.id)
                        }
                        onBlur={() => setConfirming((id) => (id === die.id ? null : id))}
                        disabled={busyId === die.id}
                        aria-label={
                          confirming === die.id
                            ? `Confirm deleting the die for ${die.job_name}`
                            : `Delete the die for ${die.job_name}`
                        }
                        className={cn(
                          'inline-flex items-center justify-center gap-1.5 min-h-11 px-3 rounded-lg',
                          'text-xs font-medium border transition-colors disabled:opacity-50 whitespace-nowrap',
                          confirming === die.id
                            ? 'border-red-300 bg-red-100 text-red-800 hover:bg-red-200'
                            : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100',
                        )}
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                        {busyId === die.id
                          ? 'Deleting…'
                          : confirming === die.id ? 'Confirm' : 'Delete'}
                      </button>
                    </div>
                  )}
                </div>
              </li>
              );
            })}
          </ul>

          {/* Desk: table with a fixed header, scrolling through the rows. */}
          <div className="hidden sm:block rounded-xl glass overflow-hidden">
            <div className="table-scroll-wrapper max-h-[70vh] overflow-y-auto">
              <table className="w-full min-w-[1450px] border-collapse text-sm text-center">
                <thead>
                  <tr>
                    {DIE_COLUMNS.map((col) => (
                      <th key={col} scope="col" className={cn(
                        'sticky top-0 z-10 px-3 py-1.5 text-center text-[11px] font-semibold text-[var(--glass-muted)]',
                        'uppercase tracking-[0.06em] whitespace-nowrap bg-[var(--glass-bg-strong)] backdrop-blur-[14px]',
                        'border-b border-white/12',
                        // The header label's own nowrap width was the real floor keeping
                        // this column from shrinking — a td-only width doesn't constrain a
                        // table column if its header cell is wider. Match the body cell's
                        // width here too, and let the label wrap instead of forcing nowrap.
                        // min-w-0 overrides the table's default per-column floor, which
                        // Chrome derives from the longest unbreakable "word" in any row's
                        // job name and otherwise ignores the explicit width above.
                        col === 'Job Name' && 'w-[220px] min-w-0 whitespace-normal',
                        // Sr No is the team's floor reference number — keep it pinned to the
                        // left edge through both scroll axes so it's always visible. z-20
                        // (above the plain top-sticky headers at z-10) so it stays on top at
                        // the corner where both stickies overlap.
                        col === 'Sr No' && 'left-0 z-20 border-r border-white/12',
                      )}>
                        {COLUMN_SORT_FIELDS[col] ? sortLabel(col, COLUMN_SORT_FIELDS[col]!) : col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedDies.map((die, i) => {
                    const isDamaged = die.status === 'DAMAGE';
                    const damageText = [
                      die.damage_date ? formatNumericDate(die.damage_date) : null,
                      die.damage_reason,
                    ].filter(Boolean).join(' — ');
                    return (
                      <tr
                        key={die.id}
                        className={cn(
                          'border-b transition-colors',
                          isDamaged
                            ? 'border-red-200/70 bg-red-50 hover:bg-red-100/70'
                            : cn('border-white/8 hover:bg-black/[0.03]', i % 2 === 1 && 'bg-[var(--glass-bg)]'),
                        )}
                      >
                        <td className="sticky left-0 z-10 px-3 py-1.5 font-mono text-xs whitespace-nowrap bg-[var(--glass-bg-strong)] backdrop-blur-[14px] border-r border-white/8">
                          {srNoMap.get(die.id) ?? '—'}
                        </td>
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          <span className={cn('text-[11px] font-medium px-1.5 py-0.5 rounded', STATUS_BADGE[die.status])}>
                            {die.status}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 font-mono text-xs font-semibold text-[var(--glass-ink)] whitespace-nowrap">
                          {die.serial_no ? die.serial_no.toUpperCase() : '—'}
                        </td>
                        <td className="px-3 py-1.5 font-semibold text-[var(--glass-ink)] w-[220px] min-w-0 whitespace-normal break-words">{die.job_name}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap">{die.corner || '—'}</td>
                        <td className="px-3 py-1.5 font-mono whitespace-nowrap">{sizeOf(die) ?? '—'}</td>
                        <td className="px-3 py-1.5 font-mono whitespace-nowrap">{die.cylinder ?? '—'}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap">{die.material || '—'}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap">{die.location || '—'}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap">{die.gap || '—'}</td>
                        <td className="px-3 py-1.5 font-mono whitespace-nowrap">{die.ups ?? '—'}</td>
                        <td className="px-3 py-1.5 font-mono whitespace-nowrap">{formatNumericDate(die.die_received_on) || '—'}</td>
                        <td className="px-3 py-1.5 text-xs text-red-800 max-w-[220px] truncate" title={damageText || undefined}>
                          {damageText || '—'}
                        </td>
                        <td className="px-3 py-1.5 text-center whitespace-nowrap">
                          {canManage && (
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                onClick={() => { setConfirming(null); setEditing(die); }}
                                aria-label={`Edit die for ${die.job_name}`}
                                title="Edit"
                                className={cn(
                                  'inline-flex items-center justify-center min-h-11 min-w-11 rounded-lg',
                                  'border border-black/[0.12] text-[var(--glass-muted)]',
                                  'hover:bg-black/[0.04] hover:text-[var(--glass-ink)] transition-colors',
                                )}
                              >
                                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>

                              {confirming === die.id ? (
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    onClick={() => remove(die)}
                                    disabled={busyId === die.id}
                                    onBlur={() => setConfirming((id) => (id === die.id ? null : id))}
                                    aria-label={`Confirm deleting the die for ${die.job_name}`}
                                    className="inline-flex items-center justify-center min-h-11 px-2.5 rounded-lg text-[11px] font-medium border border-red-300 bg-red-100 text-red-800 hover:bg-red-200 disabled:opacity-50 transition-colors whitespace-nowrap"
                                  >
                                    {busyId === die.id ? '…' : 'Confirm'}
                                  </button>
                                  <button
                                    onClick={() => setConfirming(null)}
                                    disabled={busyId === die.id}
                                    className="inline-flex items-center justify-center min-h-11 px-1.5 text-[11px] font-medium text-[var(--glass-muted)] hover:text-[var(--glass-ink)] disabled:opacity-40 transition-colors"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setConfirming(die.id)}
                                  aria-label={`Delete the die for ${die.job_name}`}
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
        </>
      )}

      {(adding || editing) && (
        <AddDieModal
          editing={editing ?? undefined}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => { setAdding(false); setEditing(null); queryClient.invalidateQueries({ queryKey: ['dies'] }); }}
        />
      )}
    </div>
  );
}

// "85 x 60" when both are known, otherwise whichever one is.
function sizeOf(die: Die): string | null {
  const parts = [die.length, die.width].filter(Boolean);
  return parts.length ? parts.join(' × ') : null;
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

function EmptyState({ hasSearch }: { hasSearch: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center text-center rounded-xl border border-black/[0.08] bg-white px-4 py-12">
      <Scissors className="w-6 h-6 text-[var(--glass-muted)]" aria-hidden="true" />
      <p className="text-sm font-medium text-[var(--glass-ink)] mt-3">
        {hasSearch ? 'No die matches that search.' : 'No dies recorded yet.'}
      </p>
      <p className="text-xs text-[var(--glass-muted)] mt-1 max-w-[42ch]">
        {hasSearch
          ? 'Try the job name, material, corner style or the serial etched on the die.'
          : 'Prepress adds dies here as they come back from the die maker.'}
      </p>
    </div>
  );
}
