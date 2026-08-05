'use client';
// src/components/admin/DiesManager.tsx
// The die library. Every cutting die the shop owns, searchable by the job it
// was cut for, its material, corner style or the serial etched on it.
//
// Read-only for most departments — the point is answering "do we already have
// a die for this" before ordering another. Prepress and Admin own the entries.

import { useState, useEffect, useCallback } from 'react';
import { Search, Plus, Pencil, Trash2, Scissors } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, formatNumericDate } from '@/lib/utils';
import type { Die, DieStatus } from '@/lib/types';
import AddDieModal from './AddDieModal';

const STATUS_BADGE: Record<DieStatus, string> = {
  'IN USE': 'bg-emerald-100 text-emerald-800 border border-emerald-200',
  'EXTRA':  'bg-amber-100 text-amber-800 border border-amber-200',
  'DAMAGE': 'bg-red-100 text-red-700 border border-red-200',
};

export default function DiesManager({ canManage }: { canManage: boolean }) {
  const [dies,      setDies]      = useState<Die[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState('');
  const [adding,    setAdding]    = useState(false);
  const [editing,   setEditing]   = useState<Die | null>(null);
  // The row whose Delete has been armed. Deleting is two taps, never a dialog.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busyId,     setBusyId]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      const res  = await fetch(`/api/dies?${params.toString()}`);
      const data = await res.json();
      if (res.ok) setDies(data.dies ?? []);
      else toast.error(data.error ?? 'Failed to load dies');
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

  async function remove(die: Die) {
    setBusyId(die.id);
    try {
      const res = await fetch(`/api/dies/${die.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to delete die');
        return;
      }
      setDies((prev) => prev.filter((d) => d.id !== die.id));
      toast.success('Die deleted');
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
        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--glass-muted)]"
            aria-hidden="true"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search job, material, corner, serial no or location"
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
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-black/[0.04]" />
          ))}
        </div>
      ) : dies.length === 0 ? (
        <EmptyState hasSearch={Boolean(search)} />
      ) : (
        <ul className="space-y-2">
          {dies.map((die) => (
            <li key={die.id} className="rounded-xl border border-black/[0.08] bg-white p-4">
              <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                <div className="min-w-0 flex-1">
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

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-[var(--glass-muted)]">
                    <Field label="Size" value={sizeOf(die)} mono />
                    <Field label="Cylinder" value={die.cylinder?.toString()} mono />
                    <Field label="Material" value={die.material} />
                    <Field label="Ups per repeat" value={die.ups?.toString()} mono />
                    <Field label="Gap across" value={die.gap} />
                    <Field label="Location" value={die.location} />
                    <Field label="Received" value={formatNumericDate(die.die_received_on)} mono />
                  </div>

                  {die.status === 'DAMAGE' && (die.damage_date || die.damage_reason) && (
                    <p className="mt-2 text-xs text-red-700 break-words">
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
          ))}
        </ul>
      )}

      {(adding || editing) && (
        <AddDieModal
          editing={editing ?? undefined}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => { setAdding(false); setEditing(null); load(); }}
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

function Field({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  if (!value || value === '—') return null;
  return (
    <span>
      {label}{' '}
      <strong className={cn('text-[var(--glass-ink)] font-semibold', mono && 'font-mono')}>
        {value}
      </strong>
    </span>
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
