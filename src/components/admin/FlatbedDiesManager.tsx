'use client';
// src/components/admin/FlatbedDiesManager.tsx
// The flatbed die library — the shop's second physical die type, alongside
// the rotary dies in DiesManager.tsx. No job/material/cylinder identity and
// no status/damage tracking (the team decided against it) — a flatbed die
// is logged and searched by its geometry (shape, size, corner radius),
// location, and a plain DB-assigned serial number (1, 2, 3, ...).
//
// Read-only for most departments — Prepress and Admin own the entries.
// Structure mirrors DiesManager.tsx, minus the columns that don't apply.

import { useState, useEffect } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Search, Plus, Pencil, Trash2, Scissors } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, formatNumericDate } from '@/lib/utils';
import { csvDate, csvTimestamp, type CsvColumn } from '@/lib/export/csv';
import type { FlatbedDie } from '@/lib/types';
import AddFlatbedDieModal from './AddFlatbedDieModal';
import CsvExportButton from './CsvExportButton';
import { SkeletonRows } from '@/components/ui/Skeleton';

// Header labels for the desk table — must stay in the same order as the
// <td>s rendered below.
const FLATBED_DIE_COLUMNS = [
  'Serial No', 'Shape', 'Size', 'Corner', 'Gap', 'Ups', 'Location', 'Received', 'Actions',
] as const;
const FLATBED_DIE_COLS = FLATBED_DIE_COLUMNS.length;

// Mirrors FLATBED_DIE_SEARCH_FIELDS in src/app/api/flatbed-dies/route.ts —
// the value sent as ?field=. "All fields" (value 'all') skips the param,
// falling back to the server's multi-column OR search.
const FLATBED_DIE_SEARCH_FIELDS: { value: string; label: string; placeholder: string }[] = [
  { value: 'all',       label: 'All fields', placeholder: 'Search shape, corner or location' },
  { value: 'serial_no', label: 'Serial no',  placeholder: 'Search by serial no' },
  { value: 'shape',     label: 'Shape',      placeholder: 'Search by shape' },
  { value: 'corner',    label: 'Corner',     placeholder: 'Search by corner' },
  { value: 'location',  label: 'Location',   placeholder: 'Search by location' },
  { value: 'length',    label: 'Size (length)', placeholder: 'Search by length' },
  { value: 'width',     label: 'Size (width)',  placeholder: 'Search by width' },
  { value: 'gap',       label: 'Gap',        placeholder: 'Search by gap' },
  { value: 'ups',       label: 'Ups',        placeholder: 'Search by ups' },
];

const FLATBED_DIE_EXPORT_COLUMNS: CsvColumn<FlatbedDie>[] = [
  { header: 'Serial No',        value: (d) => d.serial_no },
  { header: 'Shape',            value: (d) => d.shape },
  { header: 'Corner',           value: (d) => d.corner },
  { header: 'Length',           value: (d) => d.length },
  { header: 'Width',            value: (d) => d.width },
  { header: 'Ups',              value: (d) => d.ups },
  { header: 'Gap',              value: (d) => d.gap },
  { header: 'Location',         value: (d) => d.location },
  { header: 'Die Received On',  value: (d) => csvDate(d.die_received_on) },
  { header: 'Added',            value: (d) => csvTimestamp(d.created_at) },
];

export default function FlatbedDiesManager({ canManage }: { canManage: boolean }) {
  const [search,      setSearch]      = useState('');
  const [searchField, setSearchField] = useState('all');
  const [adding,      setAdding]      = useState(false);
  const [editing,     setEditing]     = useState<FlatbedDie | null>(null);
  // The row whose Delete has been armed. Deleting is two taps, never a dialog.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busyId,     setBusyId]     = useState<string | null>(null);

  const queryClient = useQueryClient();

  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [search]);

  const flatbedDiesQuery = useQuery({
    queryKey: ['flatbed-dies', debouncedSearch, searchField],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedSearch) {
        params.set('search', debouncedSearch);
        if (searchField !== 'all') params.set('field', searchField);
      }
      const res  = await fetch(`/api/flatbed-dies?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load flatbed dies');
      return (data.flatbed_dies ?? []) as FlatbedDie[];
    },
    placeholderData: keepPreviousData,
  });
  const flatbedDies = flatbedDiesQuery.data ?? [];
  const loading     = flatbedDiesQuery.isLoading;

  useEffect(() => {
    if (flatbedDiesQuery.error) toast.error((flatbedDiesQuery.error as Error).message);
  }, [flatbedDiesQuery.error]);

  async function remove(die: FlatbedDie) {
    setBusyId(die.id);
    try {
      const res = await fetch(`/api/flatbed-dies/${die.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to delete flatbed die');
        return;
      }
      queryClient.setQueriesData<FlatbedDie[]>(
        { queryKey: ['flatbed-dies'] },
        (old) => old?.filter((d) => d.id !== die.id)
      );
      toast.success('Flatbed die deleted');
    } catch {
      toast.error('Network error');
    } finally {
      setBusyId(null);
      setConfirming(null);
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
          {FLATBED_DIE_SEARCH_FIELDS.map((f) => (
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
            placeholder={FLATBED_DIE_SEARCH_FIELDS.find((f) => f.value === searchField)?.placeholder}
            aria-label="Search flatbed dies"
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

        <CsvExportButton rows={flatbedDies} columns={FLATBED_DIE_EXPORT_COLUMNS} filename="flatbed-dies" />

        {canManage && (
          <button
            onClick={() => setAdding(true)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 min-h-11 px-4 rounded-xl',
              'text-sm font-medium bg-brand-primary text-white hover:bg-brand-primary/90 transition-colors',
            )}
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            Add flatbed die
          </button>
        )}
      </div>

      {!loading && flatbedDies.length > 0 && (
        <p className="text-sm text-[var(--glass-muted)]">
          <strong className="text-[var(--glass-ink)]">{flatbedDies.length}</strong>
          {' '}{flatbedDies.length === 1 ? 'flatbed die' : 'flatbed dies'}
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
              <table className="w-full min-w-[1000px] border-collapse text-sm">
                <thead>
                  <tr>
                    {FLATBED_DIE_COLUMNS.map((col) => (
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
                  <SkeletonRows rows={5} cols={FLATBED_DIE_COLS} />
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : flatbedDies.length === 0 ? (
        <EmptyState hasSearch={Boolean(search)} />
      ) : (
        <>
          {/* Phone: card list */}
          <ul className="sm:hidden space-y-3">
            {flatbedDies.map((die) => (
              <li key={die.id} className="glass rounded-xl p-4">
                <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                  <div className="min-w-0 flex-1">
                    {/* Identity: serial no, corner style */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-[var(--glass-ink)]">
                        #{die.serial_no}
                      </span>
                      {die.corner && (
                        <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                          {die.corner}
                        </span>
                      )}
                    </div>

                    <p className="text-sm font-semibold text-[var(--glass-ink)] mt-1.5 break-words">
                      {die.shape || '—'}
                    </p>

                    {/* Specs: one labeled cell per field, aligned in a grid instead
                        of a wrapping inline list — each value gets its own space. */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3 mt-3 pt-3 border-t border-black/[0.06]">
                      <SpecField label="Size" value={sizeOf(die)} mono />
                      <SpecField label="Location" value={die.location} />
                      <SpecField label="Gap" value={die.gap} />
                      <SpecField label="Ups" value={die.ups?.toString()} mono />
                      <SpecField label="Received" value={formatNumericDate(die.die_received_on)} mono />
                    </div>
                  </div>

                  {canManage && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => { setConfirming(null); setEditing(die); }}
                        aria-label={`Edit flatbed die ${die.shape ?? ''}`}
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
                            ? `Confirm deleting the flatbed die ${die.shape ?? ''}`
                            : `Delete the flatbed die ${die.shape ?? ''}`
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
            ))}
          </ul>

          {/* Desk: table with a fixed header, scrolling through the rows. */}
          <div className="hidden sm:block rounded-xl glass overflow-hidden">
            <div className="table-scroll-wrapper max-h-[70vh] overflow-y-auto">
              <table className="w-full min-w-[1000px] border-collapse text-sm">
                <thead>
                  <tr>
                    {FLATBED_DIE_COLUMNS.map((col) => (
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
                  {flatbedDies.map((die, i) => (
                    <tr
                      key={die.id}
                      className={cn(
                        'border-b border-white/8 hover:bg-black/[0.03] transition-colors',
                        i % 2 === 1 && 'bg-[var(--glass-bg)]',
                      )}
                    >
                      <td className="px-3 py-2.5 font-mono text-xs font-semibold text-[var(--glass-ink)] whitespace-nowrap">
                        {die.serial_no}
                      </td>
                      <td className="px-3 py-2.5 font-semibold text-[var(--glass-ink)] whitespace-nowrap">{die.shape || '—'}</td>
                      <td className="px-3 py-2.5 font-mono whitespace-nowrap">{sizeOf(die) ?? '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{die.corner || '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{die.gap || '—'}</td>
                      <td className="px-3 py-2.5 font-mono whitespace-nowrap">{die.ups ?? '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{die.location || '—'}</td>
                      <td className="px-3 py-2.5 font-mono whitespace-nowrap">{formatNumericDate(die.die_received_on) || '—'}</td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        {canManage && (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              onClick={() => { setConfirming(null); setEditing(die); }}
                              aria-label={`Edit flatbed die ${die.shape ?? ''}`}
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
                                  aria-label={`Confirm deleting the flatbed die ${die.shape ?? ''}`}
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
                                aria-label={`Delete the flatbed die ${die.shape ?? ''}`}
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
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {(adding || editing) && (
        <AddFlatbedDieModal
          editing={editing ?? undefined}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => { setAdding(false); setEditing(null); queryClient.invalidateQueries({ queryKey: ['flatbed-dies'] }); }}
        />
      )}
    </div>
  );
}

// "85 x 60" when both are known, otherwise whichever one is.
function sizeOf(die: FlatbedDie): string | null {
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
        {hasSearch ? 'No flatbed die matches that search.' : 'No flatbed dies recorded yet.'}
      </p>
      <p className="text-xs text-[var(--glass-muted)] mt-1 max-w-[42ch]">
        {hasSearch
          ? 'Try the shape, corner radius or location.'
          : 'Prepress adds flatbed dies here as they come back from the die maker.'}
      </p>
    </div>
  );
}
