'use client';
// src/components/admin/DispatchHistory.tsx
// Every dispatch entry that has left the queue, been team-emailed or been
// removed — the record Reports counts dispatched labels from (migration
// 085, lib/dispatchLedger.ts). Newest first.
//
// Each row says whether it counts and what it matched: the order line
// (Sr. No.) and how much is now entered against it out of the order. The
// lists that need a look are one tap away: entries cleared without a team
// email (Confirm them, or remove them), entries with no order line, and
// lines with more entered than ordered. Removing asks why; the row stays
// here struck out, with who and when, and stops counting.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Trash2, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, formatNumericDate } from '@/lib/utils';
import type { DispatchHistoryRow } from '@/lib/types';
import { PromptModal } from './modals';

type View = 'all' | 'unconfirmed' | 'noline' | 'over' | 'removed';

const PAGE = 50;
const fmt = (n: number) => n.toLocaleString('en-IN');
const fieldCls = 'h-11 rounded-[10px] border border-brand-border bg-white px-3 text-sm text-brand-ink focus:border-brand-primary focus:outline-none focus:shadow-[0_0_0_4px_rgba(16,85,63,0.14)]';

const isOver = (r: DispatchHistoryRow) => !r.removed_at && !!r.line?.quantity && r.line.entered > r.line.quantity;
const inView: Record<View, (r: DispatchHistoryRow) => boolean> = {
  all:         () => true,
  unconfirmed: (r) => !r.removed_at && !r.confirmed_at,
  noline:      (r) => !r.removed_at && !r.line,
  over:        isOver,
  removed:     (r) => !!r.removed_at,
};
const VIEWS: { key: View; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'unconfirmed', label: 'Not confirmed' }, { key: 'noline', label: 'No order line' },
  { key: 'over', label: 'Over the order' }, { key: 'removed', label: 'Removed' },
];

export default function DispatchHistory() {
  const [rows, setRows]       = useState<DispatchHistoryRow[] | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [view, setView]       = useState<View>('all');
  const [q, setQ]             = useState('');
  const [shown, setShown]     = useState(PAGE);
  const [busyId, setBusyId]   = useState<string | null>(null);
  const [removing, setRemoving] = useState<DispatchHistoryRow | null>(null);

  const load = useCallback(async () => {
    try {
      const res  = await fetch('/api/dispatch-notifications?view=history');
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Failed to load the history'); return; }
      setRows(data.rows);
      setError(null);
    } catch {
      setError('Network error');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => Object.fromEntries(VIEWS.map((v) => [v.key, rows?.filter(inView[v.key]).length ?? 0])) as Record<View, number>, [rows]);
  const list = useMemo(() => {
    const t = q.trim().toUpperCase();
    return (rows ?? []).filter(inView[view]).filter((r) => !t
      || [r.party, r.po_number, r.pm_code ?? '', r.job_name ?? '', r.line?.sr_no ?? ''].some((s) => s.toUpperCase().includes(t)));
  }, [rows, view, q]);

  async function act(row: DispatchHistoryRow, init: RequestInit, done: string) {
    setBusyId(row.id);
    try {
      const res  = await fetch(`/api/dispatch-notifications/${row.id}`, init);
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Something went wrong'); return; }
      toast.success(done);
      await load();
    } catch {
      toast.error('Network error');
    } finally {
      setBusyId(null);
    }
  }

  const confirm = (r: DispatchHistoryRow) => act(r, { method: 'POST' }, 'Confirmed: it now counts in Reports');
  const remove  = (r: DispatchHistoryRow, reason: string) => {
    setRemoving(null);
    return act(r, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) }, 'Removed: it no longer counts');
  };

  return (
    <div className="flex flex-col gap-3">
      {removing && (
        <PromptModal
          title="Remove this dispatch entry?"
          description={<>{removing.po_number}{removing.qty != null ? <>, {fmt(removing.qty)} labels</> : null}. It stops counting in Reports and stays here struck out with your reason.</>}
          label="Why remove it"
          example="entered twice by mistake"
          required
          confirmLabel="Remove entry"
          onCancel={() => setRemoving(null)}
          onConfirm={(reason) => remove(removing, reason)}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
          {VIEWS.map((v) => (
            <button key={v.key} type="button" aria-pressed={view === v.key} onClick={() => { setView(v.key); setShown(PAGE); }}
              className={cn('inline-flex min-h-11 items-center gap-1.5 rounded-[10px] border px-3 text-sm font-medium transition-colors',
                view === v.key ? 'border-brand-primary bg-brand-surface-hover text-brand-ink' : 'border-brand-border bg-white text-brand-muted hover:text-brand-ink')}>
              {v.label}
              {rows && <span className="font-mono text-xs">{counts[v.key]}</span>}
            </button>
          ))}
        </div>
        <label className="relative">
          <span className="sr-only">Search the history</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-muted" aria-hidden="true" />
          <input value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} placeholder="Party, PO, PM code or Sr. No."
            className={cn(fieldCls, 'w-[280px] max-w-full pl-9')} />
        </label>
      </div>

      {error ? (
        <div role="alert" className="rounded-2xl border border-brand-border bg-white px-4 py-10 text-center text-sm text-brand-danger">
          {error} <button type="button" onClick={load} className="ml-2 min-h-11 font-medium text-brand-primary underline">Try again</button>
        </div>
      ) : !rows ? (
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 rounded-xl bg-brand-sunken" />)}
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-2xl border border-brand-border bg-white px-4 py-12 text-center">
          <p className="text-sm font-medium text-brand-ink">{q ? 'Nothing matches that search.' : view === 'all' ? 'No dispatch entries have been sent yet.' : 'Nothing here. All clear.'}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-brand-border bg-white shadow-[0_2px_8px_rgba(12,42,32,0.04)]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-brand-muted">
                  <th className="px-4 py-2.5">Counts from</th>
                  <th className="px-3 py-2.5">Party</th>
                  <th className="px-3 py-2.5">PO · PM code</th>
                  <th className="px-3 py-2.5 text-right">Labels</th>
                  <th className="px-3 py-2.5">Order line</th>
                  <th className="px-3 py-2.5">State</th>
                  <th className="px-4 py-2.5 text-right"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {list.slice(0, shown).map((r) => <Row key={r.id} r={r} busy={busyId === r.id} onConfirm={confirm} onRemove={setRemoving} />)}
              </tbody>
            </table>
          </div>
          {list.length > shown && (
            <div className="border-t border-brand-line-soft px-4 py-1">
              <button type="button" onClick={() => setShown(shown + PAGE)} className="min-h-11 text-sm font-medium text-brand-primary hover:underline">
                Show {Math.min(PAGE, list.length - shown)} more of {fmt(list.length - shown)}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ r, busy, onConfirm, onRemove }: {
  r: DispatchHistoryRow; busy: boolean;
  onConfirm: (r: DispatchHistoryRow) => void; onRemove: (r: DispatchHistoryRow) => void;
}) {
  const gone = !!r.removed_at;
  const state = gone ? { dot: 'bg-brand-muted', name: 'Removed' }
    : !r.confirmed_at ? { dot: 'bg-amber-400', name: 'Not confirmed' }
    : !r.line ? { dot: 'bg-amber-400', name: 'Counts, no order line' }
    : isOver(r) ? { dot: 'bg-amber-400', name: 'Counts, over the order' }
    : { dot: 'bg-brand-primary', name: 'Counts' };

  return (
    <tr className={cn('border-t border-brand-line-soft align-top', gone && 'text-brand-muted')}>
      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
        {r.confirmed_at ? formatNumericDate(r.confirmed_at) : '—'}
        <span className="block text-[11px] text-brand-muted">entered {formatNumericDate(r.created_at)}</span>
      </td>
      <td className={cn('max-w-[220px] px-3 py-3 font-medium', gone ? 'line-through' : 'text-brand-ink')}>
        <span className="block truncate">{r.party}</span>
        {r.job_name && <span className="block truncate text-xs font-normal text-brand-muted">{r.job_name}</span>}
      </td>
      <td className={cn('px-3 py-3 font-mono text-xs', gone && 'line-through')}>
        {r.po_number}{r.pm_code ? <span className="block text-brand-muted">PM {r.pm_code}</span> : null}
      </td>
      <td className={cn('px-3 py-3 text-right font-mono', gone ? 'line-through' : 'text-brand-ink')}>{r.qty != null ? fmt(r.qty) : '—'}</td>
      <td className="px-3 py-3 font-mono text-xs">
        {r.line ? (
          <>
            <span className="text-brand-ink">{r.line.sr_no ?? 'No Sr. No.'}</span>
            {r.line.quantity != null && (
              <span className={cn('block', isOver(r) ? 'font-semibold text-brand-warning' : 'text-brand-muted')}>
                {fmt(r.line.entered)} of {fmt(r.line.quantity)} entered
              </span>
            )}
          </>
        ) : <span className="text-brand-muted">none matched</span>}
      </td>
      <td className="px-3 py-3 text-xs">
        <span className="inline-flex items-center gap-2 whitespace-nowrap font-medium text-brand-ink">
          <span className={cn('h-2 w-2 shrink-0 rounded-full', state.dot)} aria-hidden="true" />
          {state.name}
        </span>
        {gone && (
          <span className="mt-1 block max-w-[260px] text-brand-muted">
            {r.removed_by ?? 'Someone'} on {formatNumericDate(r.removed_at)}: {r.remove_reason}
          </span>
        )}
        {!gone && !r.confirmed_at && <span className="mt-1 block text-brand-muted">Cleared without a team email</span>}
      </td>
      <td className="whitespace-nowrap px-4 py-1.5 text-right">
        {!gone && !r.confirmed_at && (
          <button type="button" onClick={() => onConfirm(r)} disabled={busy}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-brand-primary transition-colors hover:bg-brand-surface-hover disabled:opacity-40">
            <Check className="h-4 w-4" aria-hidden="true" /> Confirm
          </button>
        )}
        {!gone && (
          <button type="button" onClick={() => onRemove(r)} disabled={busy} aria-label={`Remove entry for ${r.po_number}`}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-brand-muted transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </td>
    </tr>
  );
}
