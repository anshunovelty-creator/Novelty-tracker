'use client';
// src/components/admin/PlatesManager.tsx
// The plate rack. Every plate Prepress has made, searchable by the party,
// PM code, item or the serial etched on the plate itself.
//
// Read-only for most departments; Prepress and Admin can add, correct and
// remove records — this list is typed by hand, so mis-entries and duplicates
// have to be fixable.

import { useState, useEffect } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Search, Plus, Pencil, Trash2, Layers } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, formatAdminDate } from '@/lib/utils';
import { csvDate, csvTimestamp, type CsvColumn } from '@/lib/export/csv';
import type { Plate } from '@/lib/types';
import AddPlateModal from './AddPlateModal';
import CsvExportButton from './CsvExportButton';
import { SkeletonRows } from '@/components/ui/Skeleton';

// Header labels for the desk table — must stay in the same order as the
// <td>s rendered below.
const PLATE_COLUMNS = [
  'Plate ID', 'Party', 'PM Code', 'Item', 'Size', 'Cylinder',
  'Labels / round', 'Location', 'Added', 'Actions',
] as const;
const PLATE_COLS = PLATE_COLUMNS.length;

// Mirrors PLATE_SEARCH_FIELDS in src/app/api/plates/route.ts — the value
// sent as ?field=. "All fields" (value 'all') skips the param, falling
// back to the server's multi-column OR search.
const PLATE_SEARCH_FIELDS: { value: string; label: string; placeholder: string }[] = [
  { value: 'all',             label: 'All fields',       placeholder: 'Search party, PM code, item or plate ID' },
  { value: 'party',           label: 'Party',            placeholder: 'Search by party' },
  { value: 'plate_id',        label: 'Plate ID',         placeholder: 'Search by plate ID' },
  { value: 'pm_code',         label: 'PM code',          placeholder: 'Search by PM code' },
  { value: 'item_name',       label: 'Item name',        placeholder: 'Search by item name' },
  { value: 'location',        label: 'Location',         placeholder: 'Search by location' },
  { value: 'across_size',     label: 'Size (across / H)', placeholder: 'Search by across size' },
  { value: 'around_size',     label: 'Size (around / W)', placeholder: 'Search by around size' },
  { value: 'cylinder',        label: 'Cylinder',         placeholder: 'Search by cylinder' },
  { value: 'label_per_round', label: 'Labels / round',   placeholder: 'Search by labels per round' },
];

const PLATE_EXPORT_COLUMNS: CsvColumn<Plate>[] = [
  { header: 'Plate ID',        value: (p) => p.plate_id ? p.plate_id.replace(/\n/g, '; ') : null },
  { header: 'Party',           value: (p) => p.party },
  { header: 'PM Code',         value: (p) => p.pm_code },
  { header: 'Item Name',       value: (p) => p.item_name },
  { header: 'Across Size (H)', value: (p) => p.across_size },
  { header: 'Around Size (W)', value: (p) => p.around_size },
  { header: 'Cylinder',        value: (p) => p.cylinder },
  { header: 'Label Per Round', value: (p) => p.label_per_round },
  { header: 'Location',        value: (p) => p.location },
  { header: 'Plate Date',      value: (p) => csvDate(p.plate_date) },
  { header: 'Added',           value: (p) => csvTimestamp(p.created_at) },
];

export default function PlatesManager({ canManage }: { canManage: boolean }) {
  const [search,      setSearch]      = useState('');
  const [searchField, setSearchField] = useState('all');
  const [adding,      setAdding]      = useState(false);
  const [editing,     setEditing]     = useState<Plate | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId,    setBusyId]    = useState<string | null>(null);

  const queryClient = useQueryClient();

  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [search]);

  const platesQuery = useQuery({
    queryKey: ['plates', debouncedSearch, searchField],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedSearch) {
        params.set('search', debouncedSearch);
        if (searchField !== 'all') params.set('field', searchField);
      }
      const res  = await fetch(`/api/plates?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load plates');
      return (data.plates ?? []) as Plate[];
    },
    placeholderData: keepPreviousData,
  });
  const plates  = platesQuery.data ?? [];
  const loading = platesQuery.isLoading;

  useEffect(() => {
    if (platesQuery.error) toast.error((platesQuery.error as Error).message);
  }, [platesQuery.error]);

  async function deletePlate(plate: Plate) {
    setBusyId(plate.id);
    try {
      const res = await fetch(`/api/plates/${plate.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to delete plate');
        return;
      }
      queryClient.setQueriesData<Plate[]>(
        { queryKey: ['plates'] },
        (old) => old?.filter((p) => p.id !== plate.id)
      );
      toast.success('Plate deleted');
    } catch {
      toast.error('Network error');
    } finally {
      setBusyId(null);
      setConfirmId(null);
    }
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
          {PLATE_SEARCH_FIELDS.map((f) => (
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
            placeholder={PLATE_SEARCH_FIELDS.find((f) => f.value === searchField)?.placeholder}
            aria-label="Search plates"
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

        <CsvExportButton rows={plates} columns={PLATE_EXPORT_COLUMNS} filename="plates" />

        {canManage && (
          <button
            onClick={() => setAdding(true)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 min-h-11 px-4 rounded-xl',
              'text-sm font-medium bg-brand-primary text-white hover:bg-brand-primary/90 transition-colors',
            )}
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            Add plate
          </button>
        )}
      </div>

      {!loading && plates.length > 0 && (
        <p className="text-sm text-[var(--glass-muted)]">
          <strong className="text-[var(--glass-ink)]">{plates.length}</strong>
          {' '}{plates.length === 1 ? 'plate' : 'plates'}
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
              <table className="w-full min-w-[1100px] border-collapse text-sm">
                <thead>
                  <tr>
                    {PLATE_COLUMNS.map((col) => (
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
                  <SkeletonRows rows={5} cols={PLATE_COLS} />
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : plates.length === 0 ? (
        <EmptyState hasSearch={Boolean(search)} />
      ) : (
        <>
          {/* Phone: card list */}
          <ul className="sm:hidden space-y-3">
            {plates.map((plate) => (
              <li key={plate.id} className="glass rounded-xl p-4">
                <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                  <div className="min-w-0 flex-1">
                    {/* Identity: one tag per etched plate ID, then party */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {plateIdsOf(plate).map((pid) => (
                        <span
                          key={pid}
                          className="font-mono text-xs font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200"
                        >
                          {pid.toUpperCase()}
                        </span>
                      ))}
                      {plate.party && (
                        <span className="text-xs font-medium text-[var(--glass-muted)]">
                          {plate.party}
                        </span>
                      )}
                    </div>

                    <p className="text-sm font-mono font-semibold text-[var(--glass-ink)] mt-1.5 break-words">
                      {plate.pm_code ?? '—'}
                    </p>
                    {plate.item_name && (
                      <p className="text-xs text-[var(--glass-muted)] mt-0.5 break-words">
                        {plate.item_name}
                      </p>
                    )}

                    {/* Specs: one labeled cell per field, aligned in a grid instead
                        of a wrapping inline list — each value gets its own space. */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3 mt-3 pt-3 border-t border-black/[0.06]">
                      <SpecField
                        label="Size"
                        value={
                          plate.across_size || plate.around_size
                            ? `${plate.across_size ?? '—'} × ${plate.around_size ?? '—'}`
                            : null
                        }
                        mono
                      />
                      <SpecField label="Cylinder" value={plate.cylinder?.toString()} mono />
                      <SpecField label="Labels / round" value={plate.label_per_round?.toString()} mono />
                      <SpecField label="Location" value={plate.location} />
                      <SpecField label="Added" value={formatAdminDate(plate.created_at)} mono />
                    </div>
                  </div>

                  {canManage && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => setEditing(plate)}
                        aria-label={`Edit plate for ${plate.party}`}
                        className={cn(
                          'inline-flex items-center justify-center gap-1.5 min-h-11 px-3 rounded-lg',
                          'text-xs font-medium border border-black/[0.12] text-[var(--glass-muted)]',
                          'hover:bg-black/[0.04] hover:text-[var(--glass-ink)] transition-colors',
                        )}
                      >
                        <Pencil className="w-4 h-4" aria-hidden="true" />
                        Edit
                      </button>

                      {confirmId === plate.id ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => deletePlate(plate)}
                            disabled={busyId === plate.id}
                            className={cn(
                              'inline-flex items-center justify-center min-h-11 px-3 rounded-lg',
                              'text-xs font-medium border border-red-200 bg-red-50 text-red-800',
                              'hover:bg-red-100 disabled:opacity-50 transition-colors whitespace-nowrap',
                            )}
                          >
                            {busyId === plate.id ? 'Deleting…' : 'Confirm'}
                          </button>
                          <button
                            onClick={() => setConfirmId(null)}
                            disabled={busyId === plate.id}
                            className="min-h-11 px-2 text-xs font-medium text-[var(--glass-muted)] hover:text-[var(--glass-ink)] disabled:opacity-40 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmId(plate.id)}
                          aria-label={`Delete plate for ${plate.party}`}
                          className={cn(
                            'inline-flex items-center justify-center gap-1.5 min-h-11 px-3 rounded-lg',
                            'text-xs font-medium border border-black/[0.12] text-[var(--glass-muted)]',
                            'hover:bg-red-50 hover:border-red-200 hover:text-red-800 transition-colors',
                          )}
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {/* Desk: table with a fixed header, scrolling through the rows. */}
          <div className="hidden sm:block rounded-xl glass overflow-hidden">
            <div className="table-scroll-wrapper max-h-[70vh] overflow-y-auto">
              <table className="w-full min-w-[1100px] border-collapse text-sm">
                <thead>
                  <tr>
                    {PLATE_COLUMNS.map((col) => (
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
                  {plates.map((plate, i) => {
                    const size = plate.across_size || plate.around_size
                      ? `${plate.across_size ?? '—'} × ${plate.around_size ?? '—'}`
                      : '—';
                    return (
                      <tr
                        key={plate.id}
                        className={cn(
                          'border-b border-white/8 hover:bg-black/[0.03] transition-colors',
                          i % 2 === 1 && 'bg-[var(--glass-bg)]',
                        )}
                      >
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <div className="flex flex-wrap items-center gap-1">
                            {plateIdsOf(plate).length > 0
                              ? plateIdsOf(plate).map((pid) => (
                                <span
                                  key={pid}
                                  className="font-mono text-xs font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200"
                                >
                                  {pid.toUpperCase()}
                                </span>
                              ))
                              : <span className="text-[var(--glass-muted)]">—</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-[var(--glass-ink)] whitespace-nowrap">{plate.party || '—'}</td>
                        <td className="px-3 py-2.5 font-mono whitespace-nowrap">{plate.pm_code ?? '—'}</td>
                        <td className="px-3 py-2.5 text-[var(--glass-muted)] whitespace-nowrap">{plate.item_name || '—'}</td>
                        <td className="px-3 py-2.5 font-mono whitespace-nowrap">{size}</td>
                        <td className="px-3 py-2.5 font-mono whitespace-nowrap">{plate.cylinder ?? '—'}</td>
                        <td className="px-3 py-2.5 font-mono whitespace-nowrap">{plate.label_per_round ?? '—'}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{plate.location || '—'}</td>
                        <td className="px-3 py-2.5 font-mono whitespace-nowrap text-[var(--glass-muted)]">{formatAdminDate(plate.created_at)}</td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          {canManage && (
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                onClick={() => setEditing(plate)}
                                aria-label={`Edit plate for ${plate.party}`}
                                title="Edit"
                                className={cn(
                                  'inline-flex items-center justify-center min-h-11 min-w-11 rounded-lg',
                                  'border border-black/[0.12] text-[var(--glass-muted)]',
                                  'hover:bg-black/[0.04] hover:text-[var(--glass-ink)] transition-colors',
                                )}
                              >
                                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>

                              {confirmId === plate.id ? (
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    onClick={() => deletePlate(plate)}
                                    disabled={busyId === plate.id}
                                    className="inline-flex items-center justify-center min-h-11 px-2.5 rounded-lg text-[11px] font-medium border border-red-200 bg-red-50 text-red-800 hover:bg-red-100 disabled:opacity-50 transition-colors whitespace-nowrap"
                                  >
                                    {busyId === plate.id ? '…' : 'Confirm'}
                                  </button>
                                  <button
                                    onClick={() => setConfirmId(null)}
                                    disabled={busyId === plate.id}
                                    className="inline-flex items-center justify-center min-h-11 px-1.5 text-[11px] font-medium text-[var(--glass-muted)] hover:text-[var(--glass-ink)] disabled:opacity-40 transition-colors"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setConfirmId(plate.id)}
                                  aria-label={`Delete plate for ${plate.party}`}
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
        <AddPlateModal
          editing={editing ?? undefined}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => { setAdding(false); setEditing(null); queryClient.invalidateQueries({ queryKey: ['plates'] }); }}
        />
      )}
    </div>
  );
}

// A plate record can hold several etched IDs, one per line (entered via
// Shift+Enter in the form) — split them out so each renders as its own tag.
function plateIdsOf(plate: Plate): string[] {
  if (!plate.plate_id) return [];
  return plate.plate_id
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
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
      <Layers className="w-6 h-6 text-[var(--glass-muted)]" aria-hidden="true" />
      <p className="text-sm font-medium text-[var(--glass-ink)] mt-3">
        {hasSearch ? 'No plates match that search.' : 'No plates recorded yet.'}
      </p>
      <p className="text-xs text-[var(--glass-muted)] mt-1 max-w-[42ch]">
        {hasSearch
          ? 'Try the party name, PM code, item name or the ID etched on the plate.'
          : 'Prepress records a plate here once it is made, so the next run can find it on the rack.'}
      </p>
    </div>
  );
}
