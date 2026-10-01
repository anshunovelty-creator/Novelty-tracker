'use client';
// src/components/admin/LabelStockManager.tsx
// The shelf. Everything printed and not yet shipped, folded by company —
// one folder per party ("DHANUKA - SANAND · 4 entries · 52,000 labels") —
// and searchable by whatever is written on the label in someone's hand.
//
// Read-only for most departments; Dispatch and Admin can add a manual
// entry, and per row: dispatch some or all of it out, edit, or delete.
// Admin alone can clear the dispatched-out history.

import dynamic from 'next/dynamic';
import { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Search, Plus, PackageCheck, History, Package, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, formatQty, formatAdminDate } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { csvTimestamp, type CsvColumn } from '@/lib/export/csv';
import type { LabelStock, StockKind } from '@/lib/types';
import CsvExportButton from './CsvExportButton';
import { SearchClearButton } from '@/components/ui/SearchClearButton';

// Loaded on first open, not with the page — it only renders when open.
const ManualStockModal   = dynamic(() => import('./ManualStockModal'), { ssr: false });
const DispatchStockModal = dynamic(() => import('./LabelStockModals').then((m) => m.DispatchStockModal), { ssr: false });
const EditStockModal     = dynamic(() => import('./LabelStockModals').then((m) => m.EditStockModal), { ssr: false });

const STOCK_EXPORT_COLUMNS: CsvColumn<LabelStock>[] = [
  { header: 'Kind',            value: (s) => s.kind },
  { header: 'Job Card Number', value: (s) => s.job_card_number },
  { header: 'PO Number',       value: (s) => s.po_number },
  { header: 'PM Code',         value: (s) => s.pm_code },
  { header: 'Party',           value: (s) => s.party },
  { header: 'Job Name',        value: (s) => s.job_name },
  { header: 'Qty',             value: (s) => s.qty },
  { header: 'Location',        value: (s) => s.location },
  { header: 'Remark',          value: (s) => s.remark },
  { header: 'Dispatched',      value: (s) => s.is_dispatched },
  { header: 'Dispatched At',   value: (s) => csvTimestamp(s.dispatched_at) },
  { header: 'Dispatched By',   value: (s) => s.dispatched_by },
  { header: 'Added',           value: (s) => csvTimestamp(s.created_at) },
];

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

type PartyFolder = {
  key:     string;          // normalised party — "Dhanuka  sanand " and "DHANUKA SANAND" are one company
  party:   string;          // as written on the newest entry
  entries: LabelStock[];
  liveQty: number;          // on the shelf; dispatched history rows don't count
  live:    number;
  locations: string[];
};

const partyKey = (party: string) => party.trim().replace(/\s+/g, ' ').toUpperCase();

/** One folder per company, A→Z; entries inside stay newest first. */
function groupByParty(stock: LabelStock[]): PartyFolder[] {
  const map = new Map<string, PartyFolder>();
  for (const s of stock) {
    const key = partyKey(s.party);
    let f = map.get(key);
    if (!f) {
      f = { key, party: s.party.trim(), entries: [], liveQty: 0, live: 0, locations: [] };
      map.set(key, f);
    }
    f.entries.push(s);
    if (!s.is_dispatched) {
      f.liveQty += s.qty;
      f.live    += 1;
      if (s.location && !f.locations.includes(s.location)) f.locations.push(s.location);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.party.localeCompare(b.party));
}

export default function LabelStockManager({
  canManage, canClearHistory = false,
}: {
  canManage: boolean;
  canClearHistory?: boolean;
}) {
  const [search,      setSearch]      = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [adding,      setAdding]      = useState(false);
  const [dispatching, setDispatching] = useState<LabelStock | null>(null);
  const [editing,     setEditing]     = useState<LabelStock | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId,      setBusyId]      = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing,     setClearing]     = useState(false);
  // Company folders that are open — several at once, to compare.
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['stock'] });

  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [search]);

  const stockQuery = useQuery({
    queryKey: ['stock', debouncedSearch, showHistory],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (showHistory)     params.set('include_dispatched', 'true');
      const res  = await fetch(`/api/stock?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load stock');
      return (data.stock ?? []) as LabelStock[];
    },
    placeholderData: keepPreviousData,
  });
  const stock   = stockQuery.data;
  const loading = stockQuery.isLoading;

  useEffect(() => {
    if (stockQuery.error) toast.error((stockQuery.error as Error).message);
  }, [stockQuery.error]);

  const folders = useMemo(() => groupByParty(stock ?? []), [stock]);

  // A search opens every company it matched — once its results have
  // arrived, not on the previous results still showing — and clearing it
  // folds them back up.
  useEffect(() => {
    if (!debouncedSearch.trim()) setOpen(new Set());
  }, [debouncedSearch]);
  useEffect(() => {
    if (debouncedSearch.trim() && !stockQuery.isPlaceholderData) {
      setOpen(new Set(folders.map((f) => f.key)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-open on search results only, not on every refetch
  }, [debouncedSearch, stockQuery.isPlaceholderData]);

  function toggle(key: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function remove(entry: LabelStock) {
    setBusyId(entry.id);
    try {
      const res  = await fetch(`/api/stock/${entry.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Failed to delete'); return; }
      toast.success(`${formatQty(entry.qty)} labels for ${entry.party} deleted`);
      refresh();
    } catch {
      toast.error('Network error');
    } finally {
      setBusyId(null);
      setConfirmDeleteId(null);
    }
  }

  async function clearHistory() {
    setClearing(true);
    try {
      const res  = await fetch('/api/stock/history', { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Failed to clear history'); return; }
      toast.success(
        data.cleared === 0
          ? 'No dispatched history to clear'
          : `Cleared ${data.cleared} dispatched ${data.cleared === 1 ? 'entry' : 'entries'} from history`,
      );
      refresh();
    } catch {
      toast.error('Network error');
    } finally {
      setClearing(false);
      setConfirmClear(false);
    }
  }

  const liveTotal = folders.reduce((sum, f) => sum + f.liveQty, 0);
  const liveCount = folders.reduce((sum, f) => sum + f.live, 0);

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
            title="Search (Ctrl+K)"
            data-global-search
            className={cn(
              'w-full min-h-11 pl-9 pr-11 rounded-xl text-sm',
              'bg-[var(--field-bg)] border border-[var(--field-border)] text-[var(--glass-ink)]',
              'placeholder:text-[var(--glass-muted)] focus:outline-none',
              'focus:border-emerald-300/70 focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
            )}
          />
          <SearchClearButton value={search} onClear={() => setSearch('')} />
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

        <CsvExportButton rows={stock ?? []} columns={STOCK_EXPORT_COLUMNS} filename="label-stock" />

        {canManage && (
          <Button intent="primary" icon={Plus} onClick={() => setAdding(true)}>
              Add stock
          </Button>
        )}
      </div>

      {/* Admin only, and only where the history is on screen — clearing
          what you can't see would be a blind delete. Live stock stays. */}
      {showHistory && canClearHistory && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {confirmClear ? (
            <>
              <span className="text-sm text-red-700">
                Permanently delete every dispatched-out entry? Stock on the shelf stays.
              </span>
              <Button intent="danger" size="sm" busy={clearing} onClick={clearHistory}>Clear history</Button>
              <Button size="sm" onClick={() => setConfirmClear(false)} disabled={clearing}>Keep</Button>
            </>
          ) : (
            <Button size="sm" intent="danger" icon={Trash2} onClick={() => setConfirmClear(true)}>
              Clear history
            </Button>
          )}
        </div>
      )}

      {/* Running total — the number people actually come here for */}
      {!loading && folders.length > 0 && (
        <p className="text-sm text-[var(--glass-muted)]">
          <strong className="text-[var(--glass-ink)] font-mono">{formatQty(liveTotal)}</strong>
          {' '}labels in stock across{' '}
          <strong className="text-[var(--glass-ink)]">{liveCount}</strong>
          {' '}{liveCount === 1 ? 'entry' : 'entries'} for{' '}
          <strong className="text-[var(--glass-ink)]">{folders.length}</strong>
          {' '}{folders.length === 1 ? 'company' : 'companies'}
          {search && ' matching your search'}
        </p>
      )}

      {loading ? (
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-14 rounded-xl bg-black/[0.04]" />
          ))}
        </div>
      ) : folders.length === 0 ? (
        <EmptyState hasSearch={Boolean(search)} showHistory={showHistory} />
      ) : (
        <ul className="space-y-2">
          {folders.map((folder) => {
            const isOpen  = open.has(folder.key);
            const panelId = `stock-folder-${folder.key.replace(/[^A-Z0-9]+/g, '-')}`;
            const history = folder.entries.length - folder.live;
            return (
              <li key={folder.key} className="rounded-xl border border-black/[0.08] bg-white overflow-hidden">
                {/* Level 1 — the company */}
                <button
                  type="button"
                  onClick={() => toggle(folder.key)}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  className={cn(
                    'w-full min-h-14 flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-black/[0.03]',
                    isOpen && 'bg-black/[0.03] border-b border-black/[0.06]',
                  )}
                >
                  <ChevronRight
                    className={cn('w-4 h-4 shrink-0 text-[var(--glass-muted)] transition-transform motion-reduce:transition-none', isOpen && 'rotate-90')}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-[var(--glass-ink)] break-words">{folder.party}</span>
                    <span className="block text-xs text-[var(--glass-muted)] mt-0.5">
                      {folder.live} {folder.live === 1 ? 'entry' : 'entries'} in stock
                      {showHistory && history > 0 && ` · ${history} dispatched`}
                      {folder.locations.length > 0 && ` · ${folder.locations.join(', ')}`}
                    </span>
                  </span>
                  <span className="font-mono text-base font-bold text-[var(--glass-ink)] shrink-0">
                    {formatQty(folder.liveQty)}
                  </span>
                </button>

                {/* Level 2 — its entries */}
                {isOpen && (
                  <ul id={panelId} className="divide-y divide-black/[0.06] bg-[var(--glass-bg)]">
                    {folder.entries.map((entry) => (
                      <StockRow
                        key={entry.id}
                        entry={entry}
                        canManage={canManage}
                        confirmingDelete={confirmDeleteId === entry.id}
                        busy={busyId === entry.id}
                        onDispatch={() => setDispatching(entry)}
                        onEdit={() => setEditing(entry)}
                        onAskDelete={() => setConfirmDeleteId(entry.id)}
                        onCancelDelete={() => setConfirmDeleteId(null)}
                        onDelete={() => remove(entry)}
                      />
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {adding && (
        <ManualStockModal
          onClose={() => setAdding(false)}
          onAdded={() => { setAdding(false); refresh(); }}
        />
      )}
      {dispatching && (
        <DispatchStockModal
          entry={dispatching}
          onClose={() => setDispatching(null)}
          onSaved={() => { setDispatching(null); refresh(); }}
        />
      )}
      {editing && (
        <EditStockModal
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}
    </div>
  );
}

function StockRow({
  entry, canManage, confirmingDelete, busy,
  onDispatch, onEdit, onAskDelete, onCancelDelete, onDelete,
}: {
  entry: LabelStock;
  canManage: boolean;
  confirmingDelete: boolean;
  busy: boolean;
  onDispatch: () => void;
  onEdit: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  return (
    <li className={cn('px-4 py-3', entry.is_dispatched && 'opacity-60')}>
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

          {entry.job_name && (
            <p className="text-sm text-[var(--glass-ink)] mt-1.5 break-words">{entry.job_name}</p>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs text-[var(--glass-muted)]">
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
        <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end shrink-0">
          <p className="font-mono text-lg font-bold text-[var(--glass-ink)] leading-none">
            {formatQty(entry.qty)}
          </p>

          {canManage && !entry.is_dispatched && (
            <div className="flex items-center gap-1.5">
              {confirmingDelete ? (
                <>
                  <span className="text-xs text-red-700 mr-1">Delete this entry?</span>
                  <Button intent="danger" size="sm" busy={busy} onClick={onDelete}>Delete</Button>
                  <Button size="sm" onClick={onCancelDelete}>Keep</Button>
                </>
              ) : (
                <>
                  <button
                    onClick={onDispatch}
                    aria-label={`Dispatch labels for ${entry.party} out of stock`}
                    className={cn(
                      'inline-flex items-center justify-center gap-1.5 min-h-11 px-3 rounded-lg',
                      'text-xs font-medium border border-emerald-200 bg-emerald-50 text-emerald-800',
                      'hover:bg-emerald-100 transition-colors whitespace-nowrap',
                    )}
                  >
                    <PackageCheck className="w-4 h-4" aria-hidden="true" />
                    Dispatch
                  </button>
                  <Button
                    size="sm" icon={Pencil}
                    aria-label={`Edit stock entry for ${entry.party}`}
                    title="Edit"
                    onClick={onEdit}
                  />
                  <Button
                    size="sm" intent="danger" icon={Trash2}
                    aria-label={`Delete stock entry for ${entry.party}`}
                    title="Delete an entry added by mistake — use Dispatch for labels that went out"
                    onClick={onAskDelete}
                  />
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
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
