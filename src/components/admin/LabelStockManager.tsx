'use client';
// src/components/admin/LabelStockManager.tsx
// The shelf. Everything printed and not yet shipped, searchable by whatever
// is written on the label in someone's hand.
//
// Read-only for most departments; Dispatch and Admin get the two verbs that
// change the shelf — add a manual entry, and mark a row dispatched out.

import { useState, useEffect, useCallback } from 'react';
import { Search, Plus, PackageCheck, History, Package } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, formatQty, formatAdminDate } from '@/lib/utils';
import type { LabelStock, StockKind } from '@/lib/types';
import ManualStockModal from './ManualStockModal';

// Kind reads as a chip, because "why is this here" is the first question
// anyone asks of a pile of labels.
const KIND_BADGE: Record<StockKind, string> = {
  Remaining: 'bg-amber-100 text-amber-800 border border-amber-200',
  Extra:     'bg-purple-100 text-purple-700 border border-purple-200',
  Manual:    'bg-slate-100 text-slate-600 border border-slate-200',
};

const KIND_HINT: Record<StockKind, string> = {
  Remaining: 'Balance of a partially dispatched order',
  Extra:     'Surplus printed beyond the order',
  Manual:    'Added by hand',
};

export default function LabelStockManager({ canManage }: { canManage: boolean }) {
  const [stock,       setStock]       = useState<LabelStock[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [adding,      setAdding]      = useState(false);
  const [busyId,      setBusyId]      = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search)      params.set('search', search);
      if (showHistory) params.set('include_dispatched', 'true');
      const res  = await fetch(`/api/stock?${params.toString()}`);
      const data = await res.json();
      if (res.ok) setStock(data.stock ?? []);
      else toast.error(data.error ?? 'Failed to load stock');
    } catch {
      toast.error('Network error');
    } finally {
      setLoading(false);
    }
  }, [search, showHistory]);

  useEffect(() => {
    const timer = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  async function markDispatched(entry: LabelStock) {
    setBusyId(entry.id);
    try {
      const res = await fetch(`/api/stock/${entry.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ is_dispatched: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to update stock');
        return;
      }
      // Out of the live list; still there if history is showing.
      setStock((prev) =>
        showHistory
          ? prev.map((s) => (s.id === entry.id ? (data.stock as LabelStock) : s))
          : prev.filter((s) => s.id !== entry.id),
      );
      toast.success(`${formatQty(entry.qty)} labels dispatched out of stock`);
    } catch {
      toast.error('Network error');
    } finally {
      setBusyId(null);
    }
  }

  const liveTotal = stock
    .filter((s) => !s.is_dispatched)
    .reduce((sum, s) => sum + s.qty, 0);

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
            placeholder="Search card no, PO, PM code, party, job or location"
            aria-label="Search label stock"
            className={cn(
              'w-full min-h-11 pl-9 pr-3 rounded-xl text-sm',
              'bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--glass-ink)]',
              'placeholder:text-[var(--glass-muted)] focus:outline-none',
              'focus:border-emerald-300/70 focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
            )}
          />
        </div>

        <button
          onClick={() => setShowHistory((v) => !v)}
          aria-pressed={showHistory}
          className={cn(
            'inline-flex items-center justify-center gap-1.5 min-h-11 px-3 rounded-xl text-sm font-medium',
            'border transition-colors',
            showHistory
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
              : 'border-black/[0.12] text-[var(--glass-muted)] hover:bg-black/[0.04] hover:text-[var(--glass-ink)]',
          )}
        >
          <History className="w-4 h-4" aria-hidden="true" />
          {showHistory ? 'Showing history' : 'Show history'}
        </button>

        {canManage && (
          <button
            onClick={() => setAdding(true)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 min-h-11 px-4 rounded-xl',
              'text-sm font-medium bg-brand-primary text-white hover:bg-brand-primary/90 transition-colors',
            )}
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            Add stock
          </button>
        )}
      </div>

      {/* Running total — the number people actually come here for */}
      {!showHistory && !loading && stock.length > 0 && (
        <p className="text-sm text-[var(--glass-muted)]">
          <strong className="text-[var(--glass-ink)] font-mono">{formatQty(liveTotal)}</strong>
          {' '}labels across{' '}
          <strong className="text-[var(--glass-ink)]">{stock.length}</strong>
          {' '}{stock.length === 1 ? 'entry' : 'entries'}
          {search && ' matching your search'}
        </p>
      )}

      {loading ? (
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-black/[0.04]" />
          ))}
        </div>
      ) : stock.length === 0 ? (
        <EmptyState hasSearch={Boolean(search)} showHistory={showHistory} />
      ) : (
        <ul className="space-y-2">
          {stock.map((entry) => (
            <li
              key={entry.id}
              className={cn(
                'rounded-xl border border-black/[0.08] bg-white p-4',
                entry.is_dispatched && 'opacity-60',
              )}
            >
              <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn('text-[11px] font-medium px-1.5 py-0.5 rounded', KIND_BADGE[entry.kind])}
                      title={KIND_HINT[entry.kind]}
                    >
                      {entry.kind}
                    </span>
                    {entry.job_card_number && (
                      <span className="font-mono text-xs font-semibold text-[var(--glass-ink)]">
                        {entry.job_card_number.toUpperCase()}
                      </span>
                    )}
                    {entry.pm_code && (
                      <span className="font-mono text-xs text-[var(--glass-muted)]">
                        PM {entry.pm_code}
                      </span>
                    )}
                    {entry.is_dispatched && (
                      <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                        Dispatched out
                      </span>
                    )}
                  </div>

                  <p className="text-sm font-semibold text-[var(--glass-ink)] mt-1.5 break-words">
                    {entry.party}
                  </p>
                  {entry.job_name && (
                    <p className="text-xs text-[var(--glass-muted)] mt-0.5 break-words">
                      {entry.job_name}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-[var(--glass-muted)]">
                    {entry.location && (
                      <span>
                        Location <strong className="text-[var(--glass-ink)]">{entry.location}</strong>
                      </span>
                    )}
                    {entry.remark && <span className="break-words">{entry.remark}</span>}
                    <span className="font-mono">Added {formatAdminDate(entry.created_at)}</span>
                    {entry.is_dispatched && entry.dispatched_at && (
                      <span className="font-mono">
                        Out {formatAdminDate(entry.dispatched_at)}
                        {entry.dispatched_by ? ` · ${entry.dispatched_by}` : ''}
                      </span>
                    )}
                  </div>
                </div>

                {/* Quantity is the headline of the row */}
                <div className="flex items-center gap-3 sm:flex-col sm:items-end shrink-0">
                  <p className="font-mono text-lg font-bold text-[var(--glass-ink)] leading-none">
                    {formatQty(entry.qty)}
                  </p>

                  {canManage && !entry.is_dispatched && (
                    <button
                      onClick={() => markDispatched(entry)}
                      disabled={busyId === entry.id}
                      aria-label={`Mark ${formatQty(entry.qty)} labels for ${entry.party} as dispatched`}
                      className={cn(
                        'inline-flex items-center justify-center gap-1.5 min-h-11 px-3 rounded-lg',
                        'text-xs font-medium border border-emerald-200 bg-emerald-50 text-emerald-800',
                        'hover:bg-emerald-100 disabled:opacity-50 transition-colors whitespace-nowrap',
                      )}
                    >
                      <PackageCheck className="w-4 h-4" aria-hidden="true" />
                      {busyId === entry.id ? 'Saving…' : 'Dispatched'}
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <ManualStockModal
          onClose={() => setAdding(false)}
          onAdded={() => { setAdding(false); load(); }}
        />
      )}
    </div>
  );
}

function EmptyState({ hasSearch, showHistory }: { hasSearch: boolean; showHistory: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center text-center rounded-xl border border-black/[0.08] bg-white px-4 py-12">
      <Package className="w-6 h-6 text-[var(--glass-muted)]" aria-hidden="true" />
      <p className="text-sm font-medium text-[var(--glass-ink)] mt-3">
        {hasSearch     ? 'No stock matches that search.'
         : showHistory ? 'No stock history yet.'
         : 'Nothing in stock right now.'}
      </p>
      <p className="text-xs text-[var(--glass-muted)] mt-1 max-w-[42ch]">
        {hasSearch
          ? 'Try the card number, PO, PM code or party name printed on the label.'
          : 'Stock appears here when a job is partially dispatched, or when Dispatch reports extra labels at full dispatch.'}
      </p>
    </div>
  );
}
