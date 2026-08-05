'use client';
// src/components/admin/PlatesManager.tsx
// The plate rack. Every plate Prepress has made, searchable by the party,
// PM code, item or the serial etched on the plate itself.
//
// Read-only for most departments; Prepress and Admin can add, correct and
// remove records — this list is typed by hand, so mis-entries and duplicates
// have to be fixable.

import { useState, useEffect, useCallback } from 'react';
import { Search, Plus, Pencil, Trash2, Layers } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, formatAdminDate, formatNumericDate } from '@/lib/utils';
import type { Plate } from '@/lib/types';
import AddPlateModal from './AddPlateModal';

export default function PlatesManager({ canManage }: { canManage: boolean }) {
  const [plates,    setPlates]    = useState<Plate[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState('');
  const [adding,    setAdding]    = useState(false);
  const [editing,   setEditing]   = useState<Plate | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId,    setBusyId]    = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      const res  = await fetch(`/api/plates?${params.toString()}`);
      const data = await res.json();
      if (res.ok) setPlates(data.plates ?? []);
      else toast.error(data.error ?? 'Failed to load plates');
    } catch {
      toast.error('Network error');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  async function deletePlate(plate: Plate) {
    setBusyId(plate.id);
    try {
      const res = await fetch(`/api/plates/${plate.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to delete plate');
        return;
      }
      setPlates((prev) => prev.filter((p) => p.id !== plate.id));
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
        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--glass-muted)]"
            aria-hidden="true"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search party, PM code, item or plate ID"
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
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-black/[0.04]" />
          ))}
        </div>
      ) : plates.length === 0 ? (
        <EmptyState hasSearch={Boolean(search)} />
      ) : (
        <ul className="space-y-2">
          {plates.map((plate) => (
            <li key={plate.id} className="rounded-xl border border-black/[0.08] bg-white p-4">
              <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {plate.plate_id && (
                      <span className="font-mono text-xs font-semibold text-[var(--glass-ink)]">
                        {plate.plate_id.toUpperCase()}
                      </span>
                    )}
                    {plate.pm_code && (
                      <span className="font-mono text-xs text-[var(--glass-muted)]">
                        PM {plate.pm_code}
                      </span>
                    )}
                    {plate.plate_date && (
                      <span className="font-mono text-xs text-[var(--glass-muted)]">
                        {formatNumericDate(plate.plate_date)}
                      </span>
                    )}
                  </div>

                  <p className="text-sm font-semibold text-[var(--glass-ink)] mt-1.5 break-words">
                    {plate.party}
                  </p>
                  {plate.item_name && (
                    <p className="text-xs text-[var(--glass-muted)] mt-0.5 break-words">
                      {plate.item_name}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-[var(--glass-muted)]">
                    {(plate.across_size || plate.around_size) && (
                      <span>
                        Size{' '}
                        <strong className="text-[var(--glass-ink)] font-mono">
                          {plate.across_size ?? '—'} × {plate.around_size ?? '—'}
                        </strong>
                      </span>
                    )}
                    {plate.cylinder !== null && (
                      <span>
                        Cylinder{' '}
                        <strong className="text-[var(--glass-ink)] font-mono">{plate.cylinder}</strong>
                      </span>
                    )}
                    {plate.label_per_round !== null && (
                      <span>
                        Labels / round{' '}
                        <strong className="text-[var(--glass-ink)] font-mono">
                          {plate.label_per_round}
                        </strong>
                      </span>
                    )}
                    {plate.location && (
                      <span>
                        Location <strong className="text-[var(--glass-ink)]">{plate.location}</strong>
                      </span>
                    )}
                    <span className="font-mono">Added {formatAdminDate(plate.created_at)}</span>
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
      )}

      {(adding || editing) && (
        <AddPlateModal
          editing={editing ?? undefined}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => { setAdding(false); setEditing(null); load(); }}
        />
      )}
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
