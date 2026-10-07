'use client';
// src/components/admin/LabelStockManager.tsx
// The shelf. Everything printed and not yet shipped, folded by company —
// one folder per party ("DHANUKA - SANAND · 4 entries · 52,000 labels") —
// and searchable by whatever is written on the label in someone's hand.
//
// Above the folders: what the shelf is worth (usable, promised, not moved
// in six months), then tabs by kind — On the shelf, Remaining, Extra,
// Manual, Dispatched history.
//
// Read-only for most departments; Dispatch and Admin can add a manual
// entry, and per row: dispatch some or all of it out, edit, or delete.
// Admin alone can clear the dispatched-out history.

import dynamic from 'next/dynamic';
import { useState, useEffect, useMemo } from 'react';
import { useUrlSearch } from '@/hooks/useUrlSearch';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Search, Plus, Package, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, formatQty, formatAdminDate } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { csvTimestamp, type CsvColumn } from '@/lib/export/csv';
import type { LabelStock, StockKind } from '@/lib/types';
import CsvExportButton from './CsvExportButton';
import { SearchClearButton } from '@/components/ui/SearchClearButton';
import { StateChip } from '@/components/ui/StateChip';
import { stockForTab, stockTotals, type StockTab } from '@/lib/stockViews';

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

// Kind reads first on a row, because "why is this here" is the first
// question anyone asks of a pile of labels. A dot + name, never a pill.
const KIND_DOT: Record<StockKind, string> = {
  Remaining: '#D97706', // promised to an open order
  Extra:     '#059669', // free to use
  Manual:    '#64748B',
};

const TABS: { value: StockTab; label: string }[] = [
  { value: 'shelf',     label: 'On the shelf' },
  { value: 'Remaining', label: 'Remaining' },
  { value: 'Extra',     label: 'Extra' },
  { value: 'Manual',    label: 'Manual' },
  { value: 'history',   label: 'Dispatched history' },
];

const KIND_HINT: Record<StockKind, string> = {
  Remaining: 'Balance of a partially dispatched order',
  Extra:     'Surplus printed beyond the order',
  Manual:    'Added by hand',
};

type PartyFolder = {
  key:     string;          // normalised party — "Dhanuka  sanand " and "DHANUKA SANAND" are one company
  party:   string;          // as written on the newest entry
  entries: LabelStock[];
  qty:     number;
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
      f = { key, party: s.party.trim(), entries: [], qty: 0, locations: [] };
      map.set(key, f);
    }
    f.entries.push(s);
    f.qty += s.qty;
    if (s.location && !s.is_dispatched && !f.locations.includes(s.location)) f.locations.push(s.location);
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
  useUrlSearch(setSearch);
  const [tab,         setTab]         = useState<StockTab>('shelf');
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

  const showHistory = tab === 'history';
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

  const shown   = useMemo(() => stockForTab(stock ?? [], tab), [stock, tab]);
  const folders = useMemo(() => groupByParty(shown), [shown]);
  const totals  = useMemo(() => stockTotals(stock ?? []), [stock]);
  const counts  = useMemo(() => {
    const live = (stock ?? []).filter((s) => !s.is_dispatched);
    return {
      shelf:     live.length,
      Remaining: live.filter((s) => s.kind === 'Remaining').length,
      Extra:     live.filter((s) => s.kind === 'Extra').length,
      Manual:    live.filter((s) => s.kind === 'Manual').length,
    } as Partial<Record<StockTab, number>>;
  }, [stock]);

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

  return (
    <div className="space-y-4">
      {/* What the shelf is worth — the numbers people come here for. Follows
          the search, so "how much Dhanuka stock is usable" is one query. */}
      <section
        aria-label="Totals"
        className="flex flex-wrap rounded-2xl border border-brand-border bg-white shadow-[0_2px_8px_rgba(12,42,32,0.04)]"
      >
        <Total
          label={<>Usable now <span className="text-brand-ink">(Extra + Manual)</span></>}
          value={totals.usableQty}
          sub={`across ${totals.usableCount} ${totals.usableCount === 1 ? 'entry' : 'entries'}`}
          loading={loading}
        />
        <Total
          label={<>Promised to open orders <span className="text-brand-ink">(Remaining)</span></>}
          value={totals.promisedQty}
          sub={`${totals.promisedCount} partial ${totals.promisedCount === 1 ? 'dispatch' : 'dispatches'} waiting`}
          loading={loading}
        />
        <Total
          label="Not moved in 6 months"
          value={totals.staleQty}
          sub={totals.staleCount > 0 ? 'worth a call to the party' : 'nothing old on the shelf'}
          tone={totals.staleCount > 0 ? 'text-brand-warning' : undefined}
          loading={loading}
        />
      </section>

      <section className="overflow-hidden rounded-2xl border border-brand-border bg-white shadow-[0_2px_8px_rgba(12,42,32,0.04)]">
        {/* Kind tabs, then search and actions */}
        <div className="flex flex-col gap-2 border-b border-brand-border px-4 pb-2 lg:flex-row lg:items-center lg:justify-between lg:gap-4 lg:px-5 lg:pb-0">
          <div role="tablist" aria-label="Kind" className="flex gap-6 overflow-x-auto overflow-y-hidden">
            {TABS.map((t) => (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={tab === t.value}
                onClick={() => setTab(t.value)}
                className={cn(
                  'flex h-12 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-0.5 text-sm transition-colors',
                  tab === t.value
                    ? 'border-brand-ink font-semibold text-brand-ink'
                    : 'border-transparent font-medium text-brand-muted hover:text-brand-ink',
                )}
              >
                {t.label}
                {counts[t.value] !== undefined && !loading && (
                  <span className="rounded-full bg-brand-sunken px-[7px] py-px font-mono text-xs font-medium text-brand-muted">
                    {counts[t.value]}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center lg:py-1.5">
            <div className="relative sm:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-muted" aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Card no, PO, PM code, party or rack"
                aria-label="Search label stock"
                title="Search this page (/)"
                data-global-search
                className={cn(
                  'h-11 w-full rounded-[10px] border border-brand-border bg-brand-surface-alt pl-9 pr-11 text-sm text-brand-ink',
                  'placeholder:text-brand-faint focus:border-brand-primary focus:bg-white focus:outline-none',
                  'focus:shadow-[0_0_0_4px_rgba(16,85,63,0.12)] transition-[border-color,box-shadow]',
                )}
              />
              <SearchClearButton value={search} onClear={() => setSearch('')} />
            </div>
            <div className="flex gap-2">
              <CsvExportButton rows={shown} columns={STOCK_EXPORT_COLUMNS} filename="label-stock" />
              {canManage && (
                <Button intent="primary" icon={Plus} onClick={() => setAdding(true)}>
                  Add stock
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Admin only, and only where the history is on screen — clearing
            what you can't see would be a blind delete. Live stock stays. */}
        {showHistory && canClearHistory && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-b border-brand-line-soft px-5 py-2.5">
            {confirmClear ? (
              <>
                <span className="text-sm text-brand-danger">
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

        {loading ? (
          <div className="space-y-2 p-4" aria-hidden="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-14 rounded-xl bg-brand-sunken" />
            ))}
          </div>
        ) : folders.length === 0 ? (
          <EmptyState hasSearch={Boolean(search)} tab={tab} />
        ) : (
          <ul className="divide-y divide-brand-border">
            {folders.map((folder) => {
              const isOpen  = open.has(folder.key);
              const panelId = `stock-folder-${folder.key.replace(/[^A-Z0-9]+/g, '-')}`;
              const n = folder.entries.length;
              return (
                <li key={folder.key}>
                  {/* Level 1 — the company */}
                  <button
                    type="button"
                    onClick={() => toggle(folder.key)}
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    className={cn(
                      'flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-brand-surface-hover lg:px-5',
                      isOpen && 'bg-brand-surface-alt',
                    )}
                  >
                    <ChevronRight
                      className={cn('h-4 w-4 shrink-0 text-brand-muted transition-transform motion-reduce:transition-none', isOpen && 'rotate-90')}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-[15px] font-semibold text-brand-ink">{folder.party}</span>
                      <span className="mt-0.5 block text-[13px] text-brand-muted">
                        {n} {n === 1 ? 'entry' : 'entries'}{showHistory ? ' dispatched' : ' in stock'}
                        {folder.locations.length > 0 && <> · rack <span className="font-mono">{folder.locations.join(', ')}</span></>}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-base font-semibold tabular-nums text-brand-ink">
                      {formatQty(folder.qty)}
                    </span>
                  </button>

                  {/* Level 2 — its entries */}
                  {isOpen && (
                    <ul id={panelId} className="divide-y divide-brand-line-soft border-t border-brand-line-soft">
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
      </section>

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
    <li className="px-4 py-3 pl-11 lg:pl-12 lg:pr-5">
      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span title={KIND_HINT[entry.kind]}>
              <StateChip label={entry.kind} dot={KIND_DOT[entry.kind]} />
            </span>
            {entry.job_card_number && (
              <span className="font-mono text-[13px] font-semibold text-brand-ink">
                {entry.job_card_number.toUpperCase()}
              </span>
            )}
            {entry.pm_code && (
              <span className="font-mono text-[13px] text-brand-muted">
                PM {entry.pm_code}
              </span>
            )}
            {entry.is_dispatched && <StateChip label="Dispatched out" dot="#94A39B" className="font-medium text-brand-muted" />}
          </div>

          {entry.job_name && (
            <p className="mt-1.5 break-words text-sm text-brand-ink">{entry.job_name}</p>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-brand-muted">
            {entry.location && (
              <span className="inline-flex rounded-lg border border-brand-border bg-brand-surface-alt px-2 py-0.5 font-mono text-xs text-brand-ink">
                {entry.location}
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
          <p className="font-mono text-base font-semibold leading-none tabular-nums text-brand-ink">
            {formatQty(entry.qty)}
          </p>

          {canManage && !entry.is_dispatched && (
            <div className="flex items-center gap-1.5">
              {confirmingDelete ? (
                <>
                  <span className="mr-1 text-xs text-brand-danger">Delete this entry?</span>
                  <Button intent="danger" size="sm" busy={busy} onClick={onDelete}>Delete</Button>
                  <Button size="sm" onClick={onCancelDelete}>Keep</Button>
                </>
              ) : (
                <>
                  <button
                    onClick={onDispatch}
                    aria-label={`Dispatch labels for ${entry.party} out of stock`}
                    className={cn(
                      'inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-[10px] px-3',
                      'border border-brand-border bg-white text-[13px] font-medium text-brand-ink',
                      'transition-colors hover:bg-brand-surface-alt',
                    )}
                  >
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

function Total({
  label, value, sub, tone, loading,
}: {
  label:    React.ReactNode;
  value:    number;
  sub:      string;
  tone?:    string;
  loading:  boolean;
}) {
  return (
    <div className="flex min-w-[200px] flex-1 flex-col gap-1 px-5 py-4 [&+&]:border-l [&+&]:border-brand-line-soft">
      <span className="text-[13px] text-brand-muted">{label}</span>
      <span className={cn('font-mono text-2xl font-semibold tabular-nums', tone ?? 'text-brand-ink')}>
        {loading ? '—' : formatQty(value)}
      </span>
      <span className="text-xs text-brand-muted">{loading ? '\u00a0' : sub}</span>
    </div>
  );
}

function EmptyState({ hasSearch, tab }: { hasSearch: boolean; tab: StockTab }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
      <Package className="h-6 w-6 text-brand-faint" aria-hidden="true" />
      <p className="mt-3 text-sm font-medium text-brand-ink">
        {hasSearch          ? 'No stock matches that search.'
         : tab === 'history' ? 'No stock history yet.'
         : tab === 'shelf'   ? 'Nothing in stock right now.'
         : `No ${tab} stock on the shelf.`}
      </p>
      <p className="mt-1 max-w-[42ch] text-xs text-brand-muted">
        {hasSearch
          ? 'Try the card number, PO, PM code or party name printed on the label.'
          : 'Stock appears here when a job is partially dispatched, or when Dispatch reports extra labels at full dispatch.'}
      </p>
    </div>
  );
}
