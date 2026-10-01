'use client';
// src/components/admin/LabelStockModals.tsx
// The two per-row label-stock forms:
//   DispatchStockModal — "how many of these went out?" All of it closes the
//                        row; part of it leaves the balance on the shelf and
//                        records the shipped part in history.
//   EditStockModal     — correct a row: qty, location, remark, and — only
//                        for a row not tied to a job — party / job / PM code.

import { useId, useState } from 'react';
import { PackageCheck, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, formatQty } from '@/lib/utils';
import type { LabelStock } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { WithUnit } from '@/components/ui/FieldAffix';
import { ModalShell } from './modals';

type Props = {
  entry:   LabelStock;
  onClose: () => void;
  onSaved: () => void;
};

function whole(v: string): number | null {
  if (!v.trim()) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

export function DispatchStockModal({ entry, onClose, onSaved }: Props) {
  const titleId = useId();
  const [qty,  setQty]  = useState(String(entry.qty));
  const [busy, setBusy] = useState(false);

  const n = whole(qty);
  const valid = n !== null && n >= 1 && n <= entry.qty;
  const left  = valid ? entry.qty - n : null;

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/stock/${entry.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ dispatch_qty: n }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Failed to dispatch stock'); return; }
      toast.success(
        left === 0
          ? `${formatQty(n)} labels dispatched — none left on the shelf`
          : `${formatQty(n)} labels dispatched — ${formatQty(left)} still in stock`,
      );
      onSaved();
    } catch {
      toast.error('Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell titleId={titleId} onClose={onClose}>
      <form className="p-6 space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div>
          <h3 id={titleId} className="font-semibold text-[var(--glass-ink)] text-base">Dispatch from stock</h3>
          <p className="text-sm text-[var(--glass-muted)] mt-1 break-words">
            {entry.party}
            {entry.job_name ? ` · ${entry.job_name}` : ''}
            {' — '}
            <strong className="font-mono text-[var(--glass-ink)]">{formatQty(entry.qty)}</strong> labels on the shelf.
          </p>
        </div>

        <label className="block">
          <StockLabel>Labels dispatched</StockLabel>
          <WithUnit unit="labels">
            <input
              type="number" inputMode="numeric" min={1} max={entry.qty} step={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              autoFocus
              className={cn(fieldCls, 'font-mono')}
            />
          </WithUnit>
        </label>

        <p className="text-sm text-[var(--glass-muted)]" aria-live="polite">
          {valid
            ? left === 0
              ? 'All of it goes out — the entry moves to history.'
              : <><strong className="font-mono text-[var(--glass-ink)]">{formatQty(left!)}</strong> labels stay in stock.</>
            : qty.trim() === ''
              ? 'Enter how many labels went out.'
              : <span className="text-red-700">Enter a whole number from 1 to {formatQty(entry.qty)}.</span>}
        </p>

        <div className="flex gap-3 justify-end pt-1">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" intent="primary" icon={PackageCheck} busy={busy} disabled={!valid}>Dispatch</Button>
        </div>
      </form>
    </ModalShell>
  );
}

export function EditStockModal({ entry, onClose, onSaved }: Props) {
  const titleId = useId();
  // Identity is the job's snapshot when there is a job — not editable here.
  const free = !entry.job_id;

  const [qty,      setQty]      = useState(String(entry.qty));
  const [party,    setParty]    = useState(entry.party);
  const [jobName,  setJobName]  = useState(entry.job_name ?? '');
  const [pmCode,   setPmCode]   = useState(entry.pm_code ?? '');
  const [location, setLocation] = useState(entry.location ?? '');
  const [remark,   setRemark]   = useState(entry.remark ?? '');
  const [busy,     setBusy]     = useState(false);

  const n = whole(qty);
  const validQty = n !== null && n >= 1;

  // Send only what changed, so an untouched field is never rewritten.
  const changes: Record<string, unknown> = {};
  if (n !== entry.qty) changes.qty = n;
  if (location.trim() !== (entry.location ?? '')) changes.location = location;
  if (remark.trim()   !== (entry.remark   ?? '')) changes.remark   = remark;
  if (free) {
    if (party.trim()   !== entry.party)               changes.party    = party;
    if (jobName.trim() !== (entry.job_name ?? ''))     changes.job_name = jobName;
    if (pmCode.trim()  !== (entry.pm_code  ?? ''))     changes.pm_code  = pmCode;
  }
  const valid = validQty && (!free || party.trim() !== '') && Object.keys(changes).length > 0;

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/stock/${entry.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(changes),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Failed to update stock'); return; }
      toast.success('Stock entry updated');
      onSaved();
    } catch {
      toast.error('Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell titleId={titleId} onClose={onClose}>
      <form className="p-6 space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div>
          <h3 id={titleId} className="font-semibold text-[var(--glass-ink)] text-base">Edit stock entry</h3>
          <p className="text-sm text-[var(--glass-muted)] mt-1 break-words">
            {free
              ? 'Added by hand — every field can be corrected.'
              : <>From job <span className="font-mono">{entry.job_card_number?.toUpperCase() ?? entry.po_number}</span> — party, job and PM code come from the job.</>}
          </p>
        </div>

        <label className="block">
          <StockLabel>Quantity in stock</StockLabel>
          <WithUnit unit="labels">
            <input
              type="number" inputMode="numeric" min={1} step={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className={cn(fieldCls, 'font-mono')}
            />
          </WithUnit>
          {!validQty && qty.trim() !== '' && (
            <span className="block text-xs text-red-700 mt-1">Enter a whole number above 0. To clear it out, use Dispatch or Delete.</span>
          )}
        </label>

        {free && (
          <>
            <label className="block">
              <StockLabel>Party</StockLabel>
              <input value={party} onChange={(e) => setParty(e.target.value)} className={fieldCls} />
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <StockLabel>Job name</StockLabel>
                <input value={jobName} onChange={(e) => setJobName(e.target.value)} className={fieldCls} />
              </label>
              <label className="block">
                <StockLabel>PM code</StockLabel>
                <input value={pmCode} onChange={(e) => setPmCode(e.target.value)} className={cn(fieldCls, 'font-mono')} />
              </label>
            </div>
          </>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <StockLabel>Location</StockLabel>
            <input value={location} onChange={(e) => setLocation(e.target.value)} className={fieldCls} />
          </label>
          <label className="block">
            <StockLabel>Remark</StockLabel>
            <input value={remark} onChange={(e) => setRemark(e.target.value)} className={fieldCls} />
          </label>
        </div>

        <div className="flex gap-3 justify-end pt-1">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" intent="primary" icon={Check} busy={busy} disabled={!valid}>Save</Button>
        </div>
      </form>
    </ModalShell>
  );
}

function StockLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--glass-muted)] mb-1.5">
      {children}
    </span>
  );
}

const fieldCls =
  'w-full min-h-11 px-3 rounded-lg text-sm bg-[var(--field-bg)] border border-[var(--field-border)] text-[var(--glass-ink)] ' +
  'placeholder:text-[var(--glass-muted)] focus:outline-none focus:border-emerald-300/70 ' +
  'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all';
