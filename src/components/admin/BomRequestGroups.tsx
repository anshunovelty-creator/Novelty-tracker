'use client';
// src/components/admin/BomRequestGroups.tsx
// One card per material in BOM → Requests. Every request for the same
// material folds into it, so the owner reads "AM89240F — 12,500 m needed
// across 3 jobs" instead of three cards to add up by hand.
//
// Built so the owner can read the order off the screen and act on it:
//   header  — material, one bold chip per width (the order itself), the
//             total needed large on the right, then the group actions
//   lines   — each LEADS with the order spec — "1,500 m × 275 mm" in a
//             block tinted by state (amber awaiting, green ordered, grey
//             closed) — then the job, the money, and a primary Order
//             button. The floor's message sits under the job as a quote;
//             rare actions live in a ⋯ menu.
//
// BomRequestFlatList is the "Each request" view: the same lines in one
// list, newest first, each carrying its own material + width (there's no
// material header above them) and its own Receive button.
//
// Group actions act on every line they apply to:
//   Order N together — awaiting ones at one width, when there are 2+
//                    (bom_decide); opens the order form, which asks how
//                    many metres are actually being bought
//   Receive · W mm — requests ordered before order tracking existed
//                    (paper_stock_manage); newer ones are received from
//                    their order on the Ordered tab.

import { useEffect, useRef, useState } from 'react';
import {
  PackageCheck, Ban, PackagePlus, MoreHorizontal, Undo2, Trash2, Quote, type LucideIcon,
} from 'lucide-react';
import { cn, formatQty, formatNumericDate } from '@/lib/utils';
import { formatInr, orderDifference } from '@/lib/bom';
import { formatMeters } from '@/lib/paperStock';
import type { BomMaterialRequestWithJob, BomRequestStatus } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { StateChip } from '@/components/ui/StateChip';

export type RequestGroup = {
  key:          string;
  materialId:   string | null;
  materialName: string;
  requests:     BomMaterialRequestWithJob[];
  meters:       number;   // open only (awaiting, or ordered and not yet received)
  sqm:          number;
  expense:      number;
  widths:       { width: number; meters: number }[];
  pending:      BomMaterialRequestWithJob[];
  pendingByWidth: Map<number, BomMaterialRequestWithJob[]>; // width → awaiting — one order per width
  receivable:   Map<number, BomMaterialRequestWithJob[]>;   // width → ordered before order tracking, not yet received
};

const round2 = (n: number) => Math.round(n * 100) / 100;
// Still needs something done: awaiting a decision, or ordered and not yet
// arrived. Received paper is history — it no longer counts toward "needed".
const isOpen = (r: BomMaterialRequestWithJob) =>
  r.status === 'pending' || (r.status === 'ordered' && !r.received_at);

/** Requests folded by material, biggest open need first. */
export function groupRequests(requests: BomMaterialRequestWithJob[]): RequestGroup[] {
  const byKey = new Map<string, RequestGroup>();
  for (const r of requests) {
    const key = r.material_id ?? `name:${r.material_name.trim().toLowerCase()}`;
    let g = byKey.get(key);
    if (!g) {
      g = {
        key, materialId: r.material_id, materialName: r.material_name, requests: [],
        meters: 0, sqm: 0, expense: 0, widths: [], pending: [], pendingByWidth: new Map(), receivable: new Map(),
      };
      byKey.set(key, g);
    }
    const width  = Number(r.material_width_mm);
    const metres = Number(r.running_meter);
    g.requests.push(r);
    if (isOpen(r)) {
      g.meters  = round2(g.meters + metres);
      g.sqm     = round2(g.sqm + metres * (width / 1000));
      g.expense = round2(g.expense + Number(r.expense));
      const w = g.widths.find((x) => x.width === width);
      if (w) w.meters = round2(w.meters + metres); else g.widths.push({ width, meters: metres });
    }
    if (r.status === 'pending') {
      g.pending.push(r);
      g.pendingByWidth.set(width, [...(g.pendingByWidth.get(width) ?? []), r]);
    }
    // Requests inside a placed order are received through the order (the
    // Ordered tab); only ones ordered before order tracking are received here.
    if (r.status === 'ordered' && !r.received_at && !r.order_id) {
      g.receivable.set(width, [...(g.receivable.get(width) ?? []), r]);
    }
  }
  const groups = Array.from(byKey.values());
  groups.forEach((g) => {
    g.widths.sort((a, b) => a.width - b.width);
    // Open lines first, newest first within each.
    g.requests.sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || b.created_at.localeCompare(a.created_at));
  });
  return groups.sort((a, b) => b.meters - a.meters || a.materialName.localeCompare(b.materialName));
}

// A state is a dot + its name (DESIGN.md) — colour encodes state only.
const STATUS_CHIP: Record<BomRequestStatus | 'received', { label: string; dot: string }> = {
  pending:   { label: 'Awaiting',  dot: '#D97706' },
  ordered:   { label: 'Ordered',   dot: '#0284C7' },
  received:  { label: 'Received',  dot: '#059669' },
  declined:  { label: 'Declined',  dot: '#B91C1C' },
  cancelled: { label: 'Withdrawn', dot: '#94A39B' },
};

type Props = {
  requests:       BomMaterialRequestWithJob[];
  canDecide:      boolean;
  canManageStock: boolean;
  busyIds:        Set<string>;
  onOrder:        (r: BomMaterialRequestWithJob) => void;
  onDecline:      (r: BomMaterialRequestWithJob) => void;
  onWithdraw:     (r: BomMaterialRequestWithJob) => void;
  onReopen:       (r: BomMaterialRequestWithJob) => void;
  onDelete:       (r: BomMaterialRequestWithJob) => void;
  onOrderAll:     (group: RequestGroup, width: number, requests: BomMaterialRequestWithJob[]) => void;
  onReceive:      (group: RequestGroup, width: number, requests: BomMaterialRequestWithJob[]) => void;
};

/** "Each request": every line in one list, open ones first, newest first. */
export function BomRequestFlatList({
  requests, canDecide, canManageStock, busyIds, onReceive, onOrderAll: _orderAll, ...lineActions
}: Props) {
  const sorted = [...requests].sort(
    (a, b) => Number(isOpen(b)) - Number(isOpen(a)) || b.created_at.localeCompare(a.created_at),
  );
  return (
    <div className="rounded-xl border border-black/[0.08] bg-white shadow-[0_1px_2px_rgba(10,31,24,0.04)]">
      <ul className="divide-y divide-black/[0.05]">
        {sorted.map((r) => (
          <RequestLine
            key={r.id}
            r={r}
            canDecide={canDecide}
            busy={busyIds.has(r.id)}
            showMaterial
            onReceiveOne={canManageStock ? (req) => onReceive(groupRequests([req])[0], Number(req.material_width_mm), [req]) : undefined}
            {...lineActions}
          />
        ))}
      </ul>
    </div>
  );
}

export default function BomRequestGroups({ requests, ...props }: Props) {
  const groups = groupRequests(requests);
  return (
    <ul className="space-y-4">
      {groups.map((g) => <GroupCard key={g.key} group={g} {...props} />)}
    </ul>
  );
}

function GroupCard({
  group: g, canDecide, canManageStock, busyIds, onOrderAll, onReceive, ...lineActions
}: Omit<Props, 'requests'> & { group: RequestGroup }) {
  const groupBusy = g.requests.some((r) => busyIds.has(r.id));
  const jobs = g.requests.length;
  // One order per width (rolls are width-specific). A width with a single
  // awaiting line already has that line's Order button — the header action
  // earns its place only when it gathers several requests into one order.
  const orderAll = canDecide
    ? Array.from(g.pendingByWidth.entries()).filter(([, rs]) => rs.length > 1)
    : [];
  const showOrderAll = orderAll.length > 0;
  const receivable = canManageStock ? Array.from(g.receivable.entries()) : [];

  return (
    <li className="rounded-xl border border-black/[0.08] bg-white shadow-[0_1px_2px_rgba(10,31,24,0.04)]">
      {/* ── Header: what to order, front and centre ─────────────── */}
      <div className="flex flex-wrap items-start gap-x-8 gap-y-4 px-5 py-4">
        <div className="min-w-[200px] flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="text-base font-semibold text-[var(--glass-ink)] break-words">{g.materialName}</h3>
            <span className="text-xs text-[var(--glass-muted)]">{jobs} {jobs === 1 ? 'job' : 'jobs'}</span>
          </div>

          {/* The order itself: one chip per width, metres in bold — what
              gets read out to the supplier. */}
          {g.widths.length > 0 && (
            <div className="mt-2.5 flex flex-wrap items-stretch gap-2">
              {g.widths.map((w) => (
                <div key={w.width} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5">
                  <p className="font-mono text-[11px] font-medium text-slate-500">{formatMeters(w.width)} mm</p>
                  <p className="font-mono text-base font-bold tabular-nums leading-tight text-slate-900">
                    {formatMeters(w.meters)}<span className="text-xs font-medium text-slate-500"> m</span>
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {g.meters > 0 && (
          <div className="flex items-start gap-6">
            <div className="text-right">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--glass-muted)]">Total needed</p>
              <p className="font-mono text-3xl font-bold tabular-nums leading-none text-[var(--glass-ink)] mt-1">
                {formatMeters(g.meters)}<span className="text-base font-semibold text-[var(--glass-muted)]"> m</span>
              </p>
              <p className="mt-1 font-mono text-xs text-[var(--glass-muted)]">{formatMeters(g.sqm)} m² · ₹{formatInr(g.expense)}</p>
            </div>
          </div>
        )}
      </div>

      {(showOrderAll || receivable.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 px-5 pb-4 -mt-1">
          {orderAll.map(([width, rs]) => (
            <Button key={width} intent="primary" icon={PackageCheck} busy={groupBusy} onClick={() => onOrderAll(g, width, rs)}>
              Order {rs.length} together · {formatMeters(width)} mm · {formatMeters(round2(rs.reduce((s, r) => s + Number(r.running_meter), 0)))} m
            </Button>
          ))}
          {receivable.map(([width, rs]) => (
            <Button key={width} intent="tinted" icon={PackagePlus} disabled={groupBusy} onClick={() => onReceive(g, width, rs)}>
              Receive {formatMeters(width)} mm · {formatMeters(round2(rs.reduce((s, r) => s + Number(r.running_meter), 0)))} m
            </Button>
          ))}
        </div>
      )}

      {/* ── The jobs behind it ─────────────────────────────────── */}
      <ul className="border-t border-black/[0.06] divide-y divide-black/[0.05]">
        {g.requests.map((r) => (
          <RequestLine key={r.id} r={r} canDecide={canDecide} busy={busyIds.has(r.id)} {...lineActions} />
        ))}
      </ul>
    </li>
  );
}

function RequestLine({
  r, canDecide, busy, showMaterial = false, onReceiveOne, onOrder, onDecline, onWithdraw, onReopen, onDelete,
}: {
  r: BomMaterialRequestWithJob; canDecide: boolean; busy: boolean;
  showMaterial?: boolean;                                   // flat view: no material header above
  onReceiveOne?: (r: BomMaterialRequestWithJob) => void;   // flat view: receive this one
  onOrder: (r: BomMaterialRequestWithJob) => void; onDecline: (r: BomMaterialRequestWithJob) => void;
  onWithdraw: (r: BomMaterialRequestWithJob) => void; onReopen: (r: BomMaterialRequestWithJob) => void;
  onDelete: (r: BomMaterialRequestWithJob) => void;
}) {
  const job = r.job;
  const closed = !isOpen(r);                                              // done with: received, declined, withdrawn
  const dropped = r.status === 'declined' || r.status === 'cancelled';   // never happened — struck through
  const chip = STATUS_CHIP[r.received_at ? 'received' : r.status];
  const difference = orderDifference(r.order_value, r.expense);
  const marginPct = difference !== null && r.order_value ? Math.round((difference / r.order_value) * 100) : null;

  const menu: MenuItem[] = [
    ...(r.status === 'pending' && canDecide ? [{ label: 'Withdraw', icon: Undo2, onClick: () => onWithdraw(r) }] : []),
    // Inside a placed order the request moves with the order (Ordered tab →
    // Cancel order), so there's no per-request undo for it.
    ...(canDecide && (r.status === 'ordered' || r.status === 'declined') && !r.received_at && !r.order_id
      ? [{ label: 'Undo decision', icon: Undo2, onClick: () => onReopen(r) }] : []),
    ...(canDecide ? [{ label: 'Delete request', icon: Trash2, onClick: () => onDelete(r), danger: true }] : []),
  ];

  // The order spec leads the line. Its tint is the line's state: amber =
  // needs a decision, green = ordered, grey = closed.
  const specTone = r.status === 'pending'
    ? 'bg-amber-50 ring-amber-200 text-amber-950'
    : r.status === 'ordered'
      ? 'bg-emerald-50 ring-emerald-200 text-emerald-950'
      : 'bg-slate-50 ring-slate-200 text-slate-500';

  return (
    <li
      className={cn(
        'grid items-center gap-x-5 gap-y-2 px-5 py-3',
        'grid-cols-[auto_minmax(0,1fr)_auto] md:grid-cols-[168px_minmax(0,1fr)_120px_auto]',
        dropped && 'bg-slate-50/50',
      )}
    >
      {/* What to order — the first thing the eye lands on */}
      <div className={cn('rounded-lg px-3 py-2 ring-1 ring-inset', specTone)}>
        <p className={cn('font-mono text-xl font-bold tabular-nums leading-none', dropped && 'line-through decoration-1')}>
          {formatQty(Number(r.running_meter))}<span className="text-xs font-semibold opacity-70"> m</span>
        </p>
        <p className="mt-1 font-mono text-xs font-semibold opacity-80 whitespace-nowrap">
          × {formatMeters(Number(r.material_width_mm))} mm
        </p>
        {showMaterial && (
          <p className="mt-0.5 font-mono text-[11px] font-medium opacity-70 truncate" title={r.material_name}>{r.material_name}</p>
        )}
      </div>

      {/* Who it's for */}
      <div className={cn('min-w-0', closed && 'opacity-70')}>
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          {job?.sr_no && <span className="font-mono text-[13px] font-semibold text-[var(--glass-ink)]">{job.sr_no}</span>}
          <span className="font-medium text-[var(--glass-ink)] truncate">{job?.party ?? 'Job removed'}</span>
        </p>
        <p className="mt-0.5 text-xs text-[var(--glass-muted)] truncate">
          <span className="font-mono">{r.ref}</span>
          {job?.material_name && <> · {job.material_name}</>}
          {' · '}{formatNumericDate(r.created_at)}
          {r.requested_by && <> · {r.requested_by.split('@')[0]}</>}
        </p>
        {r.message && (
          <p className="mt-1.5 inline-flex max-w-full items-start gap-1.5 rounded-md bg-amber-50/70 px-2 py-1 text-xs text-amber-900">
            <Quote className="mt-px h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
            <span className="break-words">{r.message}</span>
          </p>
        )}
        {r.decision_note && r.status !== 'pending' && (
          <p className="mt-1 text-xs text-[var(--glass-muted)]">
            {chip.label}{r.decided_by ? ` by ${r.decided_by.split('@')[0]}` : ''}: <span className="text-[var(--glass-ink)]">{r.decision_note}</span>
          </p>
        )}
        {/* Phone: the money under the job */}
        <p className="md:hidden mt-1 font-mono text-[11px] text-[var(--glass-muted)]">
          ₹{formatInr(r.expense)} cost
          {difference !== null && <span className={difference < 0 ? 'text-red-700' : 'text-emerald-800'}> · {marginPct}% margin</span>}
        </p>
      </div>

      {/* Money — secondary: cost, and whether the order is worth it */}
      <div className={cn('hidden md:block text-right', closed && 'opacity-70')} title={`Order value ₹${formatInr(r.order_value)} − material ₹${formatInr(r.expense)}`}>
        <p className="font-mono text-sm tabular-nums text-[var(--glass-ink)]">₹{formatInr(r.expense)}</p>
        {difference !== null ? (
          <p className={cn('font-mono text-[11px] tabular-nums', difference < 0 ? 'text-red-700' : 'text-emerald-800')}>
            {marginPct}% margin
          </p>
        ) : (
          <p className="text-[11px] text-[var(--glass-muted)]">—</p>
        )}
      </div>

      {/* Actions — the decision in words, the rest behind ⋯ */}
      <div className="flex items-center justify-end gap-1.5">
        {r.status === 'pending' && canDecide ? (
          <>
            <Button intent="primary" icon={PackageCheck} busy={busy} onClick={() => onOrder(r)}>Order</Button>
            <Button size="sm" icon={Ban} disabled={busy} onClick={() => onDecline(r)} className="text-red-700" aria-label={`Decline ${r.ref}`} title="Decline">
              <span className="hidden lg:inline">Decline</span>
            </Button>
          </>
        ) : r.status === 'pending' ? (
          <Button size="sm" busy={busy} onClick={() => onWithdraw(r)}>Withdraw</Button>
        ) : r.status === 'ordered' && !r.received_at && onReceiveOne ? (
          <Button size="sm" intent="tinted" icon={PackagePlus} disabled={busy} onClick={() => onReceiveOne(r)} title="Ordered — receive the paper into stock">
            Receive
          </Button>
        ) : (
          <span title={r.decided_at ? `${chip.label} ${formatNumericDate(r.received_at ?? r.decided_at)}` : undefined}>
            <StateChip label={chip.label} dot={chip.dot} />
          </span>
        )}
        <RowMenu items={menu} label={`More actions for ${r.ref}`} />
      </div>
    </li>
  );
}

// ── ⋯ menu for the rare actions ───────────────────────────────────
type MenuItem = { label: string; icon: LucideIcon; onClick: () => void; danger?: boolean };

function RowMenu({ items, label }: { items: MenuItem[]; label: string }) {
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

  // Keep the column aligned even when a line has nothing extra to offer.
  if (items.length === 0) return <span className="w-9 shrink-0" aria-hidden="true" />;

  return (
    <div ref={ref} className="relative shrink-0">
      <Button
        size="sm"
        icon={MoreHorizontal}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="!px-2"
      />
      {open && (
        <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-48 rounded-lg border border-black/[0.08] bg-white py-1 shadow-lg shadow-black/10">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); item.onClick(); }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-black/[0.04] focus:outline-none focus-visible:bg-black/[0.04]',
                item.danger ? 'text-red-700' : 'text-[var(--glass-ink)]',
              )}
            >
              <item.icon className="h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
