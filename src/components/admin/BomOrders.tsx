'use client';
// src/components/admin/BomOrders.tsx
// Admin's purchases in BOM → Requests.
//
//   PlaceOrderModal — "Order" on a request (or several at one width).
//                     Shows what was requested and asks how many metres are
//                     actually being bought: small orders cost more per
//                     metre and in delivery, so Admin usually orders more.
//                     Anything above the request goes to stock on arrival.
//   BomOrdersList   — the Ordered tab: one card per open order, leading
//                     with the metres ordered, the jobs it answers under
//                     it, Receive (paper_stock_manage) and ⋯ Cancel order
//                     (bom_decide, puts the requests back to Awaiting).

import { useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PackageCheck, PackagePlus, MoreHorizontal, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, formatQty, formatNumericDate } from '@/lib/utils';
import { formatMeters } from '@/lib/paperStock';
import type { BomMaterialOrder, BomMaterialRequestWithJob } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { StateChip } from '@/components/ui/StateChip';
import { ModalShell } from './modals';

const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Place an order ────────────────────────────────────────────────

export function PlaceOrderModal({
  requests, onClose,
}: {
  requests: BomMaterialRequestWithJob[];   // all awaiting, one material, one width
  onClose: () => void;
}) {
  const titleId = useId();
  const fieldId = useId();
  const queryClient = useQueryClient();
  const requested = round2(requests.reduce((s, r) => s + Number(r.running_meter), 0));
  const [value, setValue] = useState(String(requested));
  const [busy, setBusy] = useState(false);

  const first = requests[0];
  const meters = Number(value);
  const valid = value.trim() !== '' && Number.isFinite(meters) && meters > 0;
  const extra = valid ? round2(meters - requested) : 0;

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/bom-orders', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ request_ids: requests.map((r) => r.id), ordered_meter: meters }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Failed to place order'); return; }
      queryClient.invalidateQueries({ queryKey: ['bom-requests'] });
      queryClient.invalidateQueries({ queryKey: ['bom-orders'] });
      queryClient.invalidateQueries({ queryKey: ['bom-costings'] });
      toast.success(`${data.order?.ref ?? 'Order'} placed — ${formatMeters(meters)} m of ${first.material_name}`);
      onClose();
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
          <h3 id={titleId} className="font-semibold text-[var(--glass-ink)] text-base">
            Order {first.material_name} · {formatMeters(Number(first.material_width_mm))} mm
          </h3>
          <p className="text-sm text-[var(--glass-muted)] mt-1">
            Enter what you&apos;re actually buying. Anything above the request goes into stock when it arrives.
          </p>
        </div>

        {/* What was asked for */}
        <div className="rounded-lg border border-black/[0.08] bg-slate-50">
          <div className="flex items-baseline justify-between gap-3 px-3 py-2 border-b border-black/[0.06]">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--glass-muted)]">Requested</span>
            <span className="font-mono text-base font-bold text-[var(--glass-ink)]">{formatMeters(requested)} m</span>
          </div>
          <ul className="max-h-32 overflow-y-auto px-3 py-1.5 text-xs space-y-1">
            {requests.map((r) => (
              <li key={r.id} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-[var(--glass-ink)]">
                  <span className="font-mono font-semibold">{r.job?.sr_no ?? r.ref}</span> {r.job?.party}
                </span>
                <span className="font-mono text-[var(--glass-muted)] shrink-0">{formatQty(Number(r.running_meter))} m</span>
              </li>
            ))}
          </ul>
        </div>

        {/* What's being bought */}
        <div>
          <label htmlFor={fieldId} className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-[var(--glass-muted)]">
            Metres you&apos;re ordering
          </label>
          <div className="relative">
            <input
              id={fieldId}
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className={cn(
                'w-full min-h-12 pl-3 pr-10 rounded-lg text-lg font-mono font-bold bg-[var(--field-bg)] border border-[var(--field-border)] text-[var(--glass-ink)]',
                'focus:outline-none focus:border-emerald-300/70 focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
              )}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--glass-muted)]">m</span>
          </div>
          <p className="mt-1.5 text-xs" aria-live="polite">
            {!valid ? (
              <span className="text-red-700">Enter the metres you&apos;re ordering.</span>
            ) : extra > 0 ? (
              <span className="text-emerald-800">+{formatMeters(extra)} m more than requested — goes to stock.</span>
            ) : extra < 0 ? (
              <span className="text-amber-800">{formatMeters(-extra)} m less than requested.</span>
            ) : (
              <span className="text-[var(--glass-muted)]">Exactly what was requested.</span>
            )}
          </p>
        </div>

        <div className="flex gap-3 justify-end pt-1">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" intent="primary" icon={PackageCheck} busy={busy} disabled={!valid}>
            Place order{valid ? ` · ${formatMeters(meters)} m` : ''}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

// ── The Ordered tab ───────────────────────────────────────────────

export function BomOrdersList({
  orders, canDecide, canManageStock, onReceive, onCancel,
}: {
  orders: BomMaterialOrder[];
  canDecide: boolean;
  canManageStock: boolean;
  onReceive: (order: BomMaterialOrder) => void;
  onCancel: (order: BomMaterialOrder) => void;
}) {
  return (
    <ul className="space-y-3">
      {orders.map((o) => {
        const requested = round2(o.requests.reduce((s, r) => s + Number(r.running_meter), 0));
        const extra = round2(o.ordered_meter - requested);
        return (
          <li
            key={o.id}
            className={cn(
              'grid items-center gap-x-5 gap-y-3 rounded-xl border border-black/[0.08] bg-white px-5 py-4 shadow-[0_1px_2px_rgba(10,31,24,0.04)]',
              'grid-cols-[auto_minmax(0,1fr)] md:grid-cols-[168px_minmax(0,1fr)_auto]',
            )}
          >
            {/* What's coming */}
            <div className="rounded-lg bg-emerald-50 px-3 py-2 ring-1 ring-inset ring-emerald-200 text-emerald-950">
              <p className="font-mono text-xl font-bold tabular-nums leading-none">
                {formatMeters(o.ordered_meter)}<span className="text-xs font-semibold opacity-70"> m</span>
              </p>
              <p className="mt-1 font-mono text-xs font-semibold opacity-80">× {formatMeters(o.width_mm)} mm</p>
            </div>

            {/* What it's for */}
            <div className="min-w-0">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-base font-semibold text-[var(--glass-ink)]">{o.material_name}</span>
                <span className="font-mono text-xs text-[var(--glass-muted)]">
                  {o.ref} · ordered {formatNumericDate(o.created_at)}{o.ordered_by ? ` by ${o.ordered_by.split('@')[0]}` : ''}
                </span>
              </p>
              <p className="mt-1 text-xs text-[var(--glass-muted)]">
                Requested <span className="font-mono font-semibold text-[var(--glass-ink)]">{formatMeters(requested)} m</span>
                {' '}for {o.requests.length} {o.requests.length === 1 ? 'job' : 'jobs'}
                {extra > 0 && (
                  <span className="ml-2 rounded-md bg-emerald-50 px-1.5 py-0.5 font-mono font-semibold text-emerald-800">+{formatMeters(extra)} m to stock</span>
                )}
              </p>
              <p className="mt-1 text-xs text-[var(--glass-ink)] truncate">
                {o.requests.map((r, i) => (
                  <span key={r.id}>
                    {i > 0 && <span className="text-[var(--glass-muted)]"> · </span>}
                    <span className="font-mono font-semibold">{r.job?.sr_no ?? r.ref}</span> {r.job?.party}
                  </span>
                ))}
              </p>
            </div>

            {/* Receive / cancel */}
            <div className="col-span-2 md:col-span-1 flex items-center justify-end gap-1.5">
              {canManageStock ? (
                <Button intent="primary" icon={PackagePlus} onClick={() => onReceive(o)}>Receive</Button>
              ) : (
                <StateChip label="On order" dot="#0284C7" />
              )}
              {canDecide && <OrderMenu label={`More actions for ${o.ref}`} onCancel={() => onCancel(o)} />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function OrderMenu({ label, onCancel }: { label: string; onCancel: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <Button size="sm" icon={MoreHorizontal} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="!px-2" />
      {open && (
        <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-48 rounded-lg border border-black/[0.08] bg-white py-1 shadow-lg shadow-black/10">
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onCancel(); }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-700 hover:bg-black/[0.04] focus:outline-none focus-visible:bg-black/[0.04]"
          >
            <XCircle className="h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
            Cancel order
          </button>
        </div>
      )}
    </div>
  );
}
