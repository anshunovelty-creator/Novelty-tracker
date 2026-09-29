'use client';
// src/components/admin/PaperStockModals.tsx
// The two paper-stock forms, shared by BOM → Inventory and BOM → Requests:
//   ReceiveRollsModal — "5 rolls × 2000 m of BMB1450 at 110 mm" into stock.
//                       Opened blank from Inventory, pre-filled from an
//                       ordered request, or — for a placed order — locked
//                       to the order's material + width and pre-filled with
//                       the metres ordered (all of it goes to stock).
//   AdjustRollModal   — set one roll's remaining metres to what's actually
//                       on it (recount, damage, write-off), with a reason.

import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { formatMeters } from '@/lib/paperStock';
import type { BomMaterial, PaperRoll } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { ModalShell } from './modals';
import { WithExample } from '@/components/ui/FieldAffix';

export type ReceivePrefill = {
  material_id?:       string;
  width_mm?:          number;
  roll_count?:        number;
  meters_per_roll?:   number;
  source_request_id?:  string;
  source_request_ids?: string[];  // one delivery answering several requests
  source_label?:       string;    // "BOM-0042" / "3 requests" / "ORD-0001" — shown in the title
  order_id?:           string;    // receiving a placed order (bom_material_orders)
  ordered_meter?:      number;    // what that order was for — compared against what arrived
};

function num(v: string): number | null {
  if (!v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Every stock write touches the same three views. */
export function useRefreshStock() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['paper-stock'] });
    queryClient.invalidateQueries({ queryKey: ['bom-costings'] });
    queryClient.invalidateQueries({ queryKey: ['bom-requests'] });
    queryClient.invalidateQueries({ queryKey: ['bom-orders'] });
  };
}

export function ReceiveRollsModal({
  materials, prefill, onClose,
}: {
  materials: BomMaterial[];
  prefill?: ReceivePrefill;
  onClose: () => void;
}) {
  const titleId = useId();
  const refresh = useRefreshStock();
  const [materialId, setMaterialId] = useState(prefill?.material_id ?? '');
  const [width,      setWidth]      = useState(prefill?.width_mm ? String(prefill.width_mm) : '');
  const [count,      setCount]      = useState(String(prefill?.roll_count ?? 1));
  const [perRoll,    setPerRoll]    = useState(prefill?.meters_per_roll ? String(prefill.meters_per_roll) : '');
  const [location,   setLocation]   = useState('');
  const [supplier,   setSupplier]   = useState('');
  const [note,       setNote]       = useState('');
  const [busy,       setBusy]       = useState(false);

  // Receiving a placed order: material and width are the order's, not
  // editable — the rolls must be what was bought.
  const orderMode = !!prefill?.order_id;
  const ordered = prefill?.ordered_meter ?? null;

  const options = materials.filter((m) => m.is_active || m.id === materialId);
  const w = num(width), c = num(count), p = num(perRoll);
  const total = c !== null && p !== null && c > 0 && p > 0 ? c * p : null;
  const valid = !!materialId && w !== null && w > 0 && c !== null && Number.isInteger(c) && c >= 1 && c <= 500 && p !== null && p > 0;

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const res = orderMode
        ? await fetch(`/api/bom-orders/${prefill!.order_id}/receive`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roll_count: c, meters_per_roll: p, location, note }),
          })
        : await fetch('/api/paper-stock', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              material_id: materialId, width_mm: w, roll_count: c, meters_per_roll: p,
              location, supplier, note,
              source_request_id:  prefill?.source_request_id ?? null,
              source_request_ids: prefill?.source_request_ids ?? null,
            }),
          });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Failed to add rolls'); return; }
      const name = materials.find((m) => m.id === materialId)?.name ?? 'material';
      toast.success(`${c} roll${c === 1 ? '' : 's'} of ${name} added to stock`);
      refresh();
      onClose();
    } catch {
      toast.error('Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell titleId={titleId} onClose={onClose}>
      <form
        className="p-6 space-y-4"
        onSubmit={(e) => { e.preventDefault(); submit(); }}
      >
        <div>
          <h3 id={titleId} className="font-semibold text-[var(--glass-ink)] text-base">
            {prefill?.source_label ? `Receive ${prefill.source_label} into stock` : 'Add rolls to stock'}
          </h3>
          <p className="text-sm text-[var(--glass-muted)] mt-1">
            {orderMode
              ? 'Enter what actually arrived — split it into rolls. All of it goes to stock.'
              : 'Each roll gets its own number (R-0001…) so part-used rolls can be tracked.'}
          </p>
        </div>

        <Field label="Material">
          <select value={materialId} onChange={(e) => setMaterialId(e.target.value)} className={cn(fieldCls, orderMode && 'opacity-70')} required disabled={orderMode}>
            <option value="">— pick material —</option>
            {options.map((m) => (
              <option key={m.id} value={m.id}>{m.name}{m.specification ? ` · ${m.specification}` : ''}</option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Width (mm)">
            <input type="number" min="0" step="any" inputMode="decimal" value={width} onChange={(e) => setWidth(e.target.value)} readOnly={orderMode} className={cn(fieldCls, 'font-mono', orderMode && 'opacity-70')} />
          </Field>
          <Field label="No. of rolls">
            <input type="number" min="1" max="500" step="1" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} className={cn(fieldCls, 'font-mono')} />
          </Field>
          <Field label="Metres / roll">
            <input type="number" min="0" step="any" inputMode="decimal" value={perRoll} onChange={(e) => setPerRoll(e.target.value)} className={cn(fieldCls, 'font-mono')} />
          </Field>
        </div>

        <p className="text-sm text-[var(--glass-muted)]" aria-live="polite">
          {total !== null
            ? <>Total <strong className="font-mono text-[var(--glass-ink)]">{formatMeters(total)} m</strong> across {c} roll{c === 1 ? '' : 's'}</>
            : 'Enter width, number of rolls and metres per roll.'}
          {orderMode && ordered !== null && total !== null && Math.abs(total - ordered) > 0.005 && (
            <span className="block mt-1 text-amber-800">
              {formatMeters(ordered)} m was ordered — this receives {formatMeters(Math.abs(Math.round((total - ordered) * 100) / 100))} m {total < ordered ? 'less' : 'more'}.
            </span>
          )}
        </p>

        <div className={cn('grid gap-3', orderMode ? 'grid-cols-1' : 'grid-cols-2')}>
          <Field label="Location (optional)">
            <input value={location} onChange={(e) => setLocation(e.target.value)} className={fieldCls} />
          </Field>
          {!orderMode && (
            <Field label="Supplier (optional)">
              <input value={supplier} onChange={(e) => setSupplier(e.target.value)} className={fieldCls} />
            </Field>
          )}
        </div>
        <Field label="Note (optional)">
          <WithExample example="invoice no., batch"><input value={note} onChange={(e) => setNote(e.target.value)} className={fieldCls} /></WithExample>
        </Field>

        <div className="flex gap-3 justify-end pt-1">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" intent="primary" busy={busy} disabled={!valid}>Add to stock</Button>
        </div>
      </form>
    </ModalShell>
  );
}

export function AdjustRollModal({ roll, onClose }: { roll: PaperRoll; onClose: () => void }) {
  const titleId = useId();
  const refresh = useRefreshStock();
  const [remaining, setRemaining] = useState(String(roll.remaining_meter));
  const [location,  setLocation]  = useState(roll.location ?? '');
  const [reason,    setReason]    = useState('');
  const [busy,      setBusy]      = useState(false);

  const r = num(remaining);
  const validRemaining = r !== null && r >= 0 && r <= roll.initial_meter;
  const remainingChanged = r !== roll.remaining_meter;
  const locationChanged = location.trim() !== (roll.location ?? '');
  const valid = validRemaining && (remainingChanged || locationChanged);

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = {};
      if (remainingChanged) { body.remaining_meter = r; body.note = reason; }
      if (locationChanged) body.location = location;
      const res = await fetch(`/api/paper-stock/${roll.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Failed to update roll'); return; }
      toast.success(`${roll.ref} updated`);
      refresh();
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
          <h3 id={titleId} className="font-semibold text-[var(--glass-ink)] text-base">Adjust {roll.ref}</h3>
          <p className="text-sm text-[var(--glass-muted)] mt-1">
            {roll.material_name} · {formatMeters(roll.width_mm)} mm · started at {formatMeters(roll.initial_meter)} m.
            Set 0 to write the roll off.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Remaining (m)">
            <input type="number" min="0" max={roll.initial_meter} step="any" inputMode="decimal" value={remaining} onChange={(e) => setRemaining(e.target.value)} className={cn(fieldCls, 'font-mono')} />
          </Field>
          <Field label="Location">
            <input value={location} onChange={(e) => setLocation(e.target.value)} className={fieldCls} />
          </Field>
        </div>
        {!validRemaining && remaining.trim() !== '' && (
          <p className="text-xs text-red-700">Enter 0 to {formatMeters(roll.initial_meter)} m.</p>
        )}
        {remainingChanged && validRemaining && (
          <Field label="Reason (optional)">
            <WithExample example="physical count, damaged edge"><input value={reason} onChange={(e) => setReason(e.target.value)} className={fieldCls} /></WithExample>
          </Field>
        )}
        <div className="flex gap-3 justify-end pt-1">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" intent="primary" busy={busy} disabled={!valid}>Save</Button>
        </div>
      </form>
    </ModalShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-[var(--glass-muted)]">{label}</span>
      {children}
    </label>
  );
}

const fieldCls =
  'w-full min-h-11 px-3 rounded-lg text-sm bg-[var(--field-bg)] border border-[var(--field-border)] text-[var(--glass-ink)] ' +
  'placeholder:text-[var(--glass-muted)] focus:outline-none focus:border-emerald-300/70 ' +
  'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all';
