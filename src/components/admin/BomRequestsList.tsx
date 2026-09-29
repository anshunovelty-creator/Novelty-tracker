'use client';
// src/components/admin/BomRequestsList.tsx
// BOM → Requests: the owner's inbox for the material the floor asks for.
//
// Lifecycle: Awaiting → Ordered → Received (or Closed). Ordering asks how
// many metres are actually being bought (PlaceOrderModal) — usually more
// than requested, the surplus going to stock — and creates an order. The
// Ordered tab lists those orders (BomOrdersList); receiving one enters
// what arrived as rolls.
//
// Two views of the same request lines (see BomRequestGroups):
//   By material  — one card per material with the combined need, so every
//                  request for the same paper is seen at once (default)
//   Each request — one flat list, newest first
// The choice is remembered per browser. Status is a row of tabs with live
// counts (Awaiting · Ordered · Closed · All), so "what needs me" is
// visible without opening anything.
//
// Two audiences, one list, split by `canDecide`: Admin answers (Order /
// Decline with an optional note, Order all per material), Production
// watches and can withdraw a request nobody has answered yet. Whoever
// manages paper stock receives ordered paper straight into Inventory.
//
// All requests load in one query and are filtered here — the counts on the
// tabs need every status anyway, and the volume is a few hundred rows.
// Polls quietly; paused while a prompt is open.

import { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Inbox } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, formatQty } from '@/lib/utils';
import { formatMeters } from '@/lib/paperStock';
import type { BomMaterial, BomMaterialOrder, BomMaterialRequestWithJob } from '@/lib/types';
import { Skeleton } from '@/components/ui/Skeleton';
import { PromptModal, ConfirmModal } from './modals';
import { ReceiveRollsModal, type ReceivePrefill } from './PaperStockModals';
import BomRequestGroups, { BomRequestFlatList, type RequestGroup } from './BomRequestGroups';
import { PlaceOrderModal, BomOrdersList } from './BomOrders';

const POLL_MS = 30_000;

type Filter = 'pending' | 'ordered' | 'received' | 'closed' | 'all';

// Requests ordered before order tracking have no order to receive through;
// they stay on the Ordered tab as requests until received.
const legacyOrdered = (r: BomMaterialRequestWithJob) => r.status === 'ordered' && !r.order_id && !r.received_at;

const FILTERS: { value: Filter; label: string; match: (r: BomMaterialRequestWithJob) => boolean }[] = [
  { value: 'pending',  label: 'Awaiting', match: (r) => r.status === 'pending' },
  { value: 'ordered',  label: 'Ordered',  match: legacyOrdered },
  { value: 'received', label: 'Received', match: (r) => r.status === 'ordered' && !!r.received_at },
  { value: 'closed',   label: 'Closed',   match: (r) => r.status === 'declined' || r.status === 'cancelled' },
  { value: 'all',      label: 'All',      match: () => true },
];
const EMPTY_ORDERS: BomMaterialOrder[] = [];

const EMPTY: BomMaterialRequestWithJob[] = [];
const EMPTY_MATERIALS: BomMaterial[] = [];

type Action = 'order' | 'decline' | 'reopen' | 'withdraw';

type View = 'material' | 'each';
const VIEW_KEY = 'bom-requests-view';

const VIEWS: { value: View; label: string }[] = [
  { value: 'material', label: 'By material' },
  { value: 'each',     label: 'Each request' },
];

type Props = { canDecide: boolean; canManageStock: boolean };

export default function BomRequestsList({ canDecide, canManageStock }: Props) {
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState<Filter>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkIds, setBulkIds] = useState<string[]>([]);
  const [declining, setDeclining] = useState<BomMaterialRequestWithJob | null>(null);
  const [deleting,  setDeleting]  = useState<BomMaterialRequestWithJob | null>(null);
  const [receiving, setReceiving] = useState<ReceivePrefill | null>(null);
  const [ordering,  setOrdering]  = useState<BomMaterialRequestWithJob[] | null>(null);
  const [cancelling, setCancelling] = useState<BomMaterialOrder | null>(null);

  // Remembered per browser — a convenience, so storage failing is harmless.
  const [view, setView] = useState<View>('material');
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved === 'material' || saved === 'each') setView(saved);
    } catch { /* private mode / blocked storage — keep the default */ }
  }, []);
  function chooseView(next: View) {
    setView(next);
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* ignore */ }
  }

  const busyIds = useMemo(() => new Set([...(busyId ? [busyId] : []), ...bulkIds]), [busyId, bulkIds]);

  const requestsQuery = useQuery({
    queryKey: ['bom-requests', 'all'],
    queryFn: async () => {
      const res  = await fetch('/api/bom-requests?status=all');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load requests');
      return (data.requests ?? []) as BomMaterialRequestWithJob[];
    },
    placeholderData: keepPreviousData,
    refetchInterval: declining || receiving || deleting || ordering ? false : POLL_MS,
  });
  const all     = requestsQuery.data ?? EMPTY;

  // Open orders — what the Ordered tab lists and Receive works from.
  const ordersQuery = useQuery({
    queryKey: ['bom-orders', 'ordered'],
    queryFn: async () => {
      const res  = await fetch('/api/bom-orders?status=ordered');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load orders');
      return (data.orders ?? []) as BomMaterialOrder[];
    },
    placeholderData: keepPreviousData,
    refetchInterval: receiving || cancelling ? false : POLL_MS,
  });
  const orders = ordersQuery.data ?? EMPTY_ORDERS;
  const loading = requestsQuery.isLoading;

  useEffect(() => {
    if (requestsQuery.error) toast.error((requestsQuery.error as Error).message);
  }, [requestsQuery.error]);

  const materialsQuery = useQuery({
    queryKey: ['bom-materials'],
    queryFn: async () => {
      const res  = await fetch('/api/bom-materials');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load materials');
      return (data.materials ?? []) as BomMaterial[];
    },
    enabled: canManageStock,
  });

  const counts = useMemo(() => {
    const c = Object.fromEntries(FILTERS.map((f) => [f.value, all.filter(f.match).length])) as Record<Filter, number>;
    c.ordered += orders.length;   // open orders + requests ordered before order tracking
    return c;
  }, [all, orders]);
  const visible = useMemo(() => all.filter(FILTERS.find((f) => f.value === filter)!.match), [all, filter]);
  const awaitingMetres = useMemo(
    () => all.filter((r) => r.status === 'pending').reduce((s, r) => s + Number(r.running_meter), 0),
    [all],
  );

  function refresh() {
    // Every variant of the list, the costing sheet's request chips and the
    // nav badge all read from these.
    queryClient.invalidateQueries({ queryKey: ['bom-requests'] });
    queryClient.invalidateQueries({ queryKey: ['bom-orders'] });
    queryClient.invalidateQueries({ queryKey: ['bom-costings'] });
  }

  async function act(request: BomMaterialRequestWithJob, action: Action, note?: string) {
    setBusyId(request.id);
    try {
      const res = await fetch(`/api/bom-requests/${request.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action, note }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Failed to update request'); return; }
      refresh();
      const verb: Record<Action, string> = {
        order: 'ordered', decline: 'declined', reopen: 'moved back to Awaiting', withdraw: 'withdrawn',
      };
      toast.success(`${request.ref} ${verb[action]}`);
    } catch {
      toast.error('Network error');
    } finally {
      setBusyId(null);
    }
  }

  function receiveOrder(order: BomMaterialOrder) {
    setReceiving({
      material_id:     order.material_id ?? undefined,
      width_mm:        order.width_mm,
      roll_count:      1,
      meters_per_roll: order.ordered_meter,
      order_id:        order.id,
      ordered_meter:   order.ordered_meter,
      source_label:    order.ref,
    });
  }

  async function cancelOrder(order: BomMaterialOrder) {
    try {
      const res  = await fetch(`/api/bom-orders/${order.id}/cancel`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Failed to cancel order'); return; }
      refresh();
      toast.success(`${order.ref} cancelled — its requests are back in Awaiting`);
    } catch {
      toast.error('Network error');
    }
  }

  function receive(group: RequestGroup, width: number, rs: BomMaterialRequestWithJob[]) {
    const metres = Math.round(rs.reduce((sum, r) => sum + Number(r.running_meter), 0) * 100) / 100;
    setReceiving({
      material_id:        group.materialId ?? undefined,
      width_mm:           width,
      roll_count:         1,
      meters_per_roll:    metres,
      source_request_ids: rs.map((r) => r.id),
      source_label:       rs.length === 1 ? rs[0].ref : `${rs.length} requests`,
    });
  }

  async function remove(request: BomMaterialRequestWithJob) {
    setBusyId(request.id);
    try {
      const res  = await fetch(`/api/bom-requests/${request.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Failed to delete'); return; }
      refresh();
      toast.success(`${request.ref} deleted`);
    } catch {
      toast.error('Network error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* ── Status tabs with counts, and the one number that matters ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Request status" className="inline-flex items-center gap-1 rounded-xl border border-black/[0.08] bg-white p-1">
          {FILTERS.map((f) => {
            const selected = filter === f.value;
            const n = counts[f.value] ?? 0;
            return (
              <button
                key={f.value}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setFilter(f.value)}
                className={cn(
                  'inline-flex items-center gap-1.5 min-h-9 px-3.5 rounded-lg text-sm font-medium transition-colors',
                  selected ? 'bg-slate-800 text-white' : 'text-[var(--glass-muted)] hover:text-[var(--glass-ink)] hover:bg-black/[0.04]',
                )}
              >
                {f.label}
                <span
                  className={cn(
                    'min-w-[1.25rem] rounded-full px-1.5 text-[11px] font-semibold tabular-nums text-center',
                    selected
                      ? 'bg-white/20 text-white'
                      : f.value === 'pending' && n > 0 ? 'bg-amber-100 text-amber-800' : 'bg-black/[0.05] text-[var(--glass-muted)]',
                  )}
                >
                  {n}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {!loading && counts.pending > 0 && (
            <p className="text-sm text-[var(--glass-muted)]">
              <strong className="font-mono text-[var(--glass-ink)]">{formatQty(Math.round(awaitingMetres))} m</strong> awaiting a decision
            </p>
          )}
          <div role="radiogroup" aria-label="Show requests" className="inline-flex items-center gap-0.5 rounded-lg border border-black/[0.08] bg-white p-0.5">
            {VIEWS.map((v) => (
              <button
                key={v.value}
                type="button"
                role="radio"
                aria-checked={view === v.value}
                onClick={() => chooseView(v.value)}
                className={cn(
                  'min-h-9 px-3 rounded-md text-sm font-medium transition-colors',
                  view === v.value
                    ? 'bg-emerald-50 text-emerald-900 shadow-[inset_0_0_0_1px_rgba(16,85,63,0.25)]'
                    : 'text-[var(--glass-muted)] hover:text-[var(--glass-ink)] hover:bg-black/[0.04]',
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-xl border border-black/[0.08] bg-white">
              <div className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-24" />
                </div>
                <Skeleton className="h-9 w-40" />
              </div>
              <div className="border-t border-black/[0.06] px-5 py-3 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : filter === 'ordered' && counts.ordered > 0 ? (
        <div className="space-y-5">
          {orders.length > 0 && (
            <BomOrdersList
              orders={orders}
              canDecide={canDecide}
              canManageStock={canManageStock}
              onReceive={receiveOrder}
              onCancel={setCancelling}
            />
          )}
          {visible.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-[var(--glass-muted)]">Ordered before order tracking — receive per request</p>
              <BomRequestGroups
                requests={visible}
                canDecide={canDecide}
                canManageStock={canManageStock}
                busyIds={busyIds}
                onOrder={(r) => setOrdering([r])}
                onDecline={setDeclining}
                onWithdraw={(r) => act(r, 'withdraw')}
                onReopen={(r) => act(r, 'reopen')}
                onDelete={setDeleting}
                onOrderAll={(_g, _w, rs) => setOrdering(rs)}
                onReceive={receive}
              />
            </div>
          )}
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-black/[0.08] bg-white px-4 py-14 text-center">
          <Inbox className="h-6 w-6 text-[var(--glass-muted)]" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-[var(--glass-ink)]">
            {filter === 'pending' ? 'Nothing waiting' : filter === 'ordered' ? 'Nothing on order' : filter === 'received' ? 'Nothing received yet' : 'Nothing here'}
          </p>
          <p className="mt-1 max-w-sm text-xs text-[var(--glass-muted)]">
            {filter === 'pending'
              ? canDecide
                ? 'No material requests from Production right now.'
                : 'Every request has been answered. Press Request on a costed row when the floor needs material.'
              : filter === 'ordered'
                ? 'Orders Admin places show here until the paper is received into stock.'
                : filter === 'received'
                  ? 'Requests whose paper has arrived and gone into stock show here.'
                  : 'Declined and withdrawn requests show here.'}
          </p>
        </div>
      ) : view === 'each' ? (
        <BomRequestFlatList
          requests={visible}
          canDecide={canDecide}
          canManageStock={canManageStock}
          busyIds={busyIds}
          onOrder={(r) => setOrdering([r])}
          onDecline={setDeclining}
          onWithdraw={(r) => act(r, 'withdraw')}
          onReopen={(r) => act(r, 'reopen')}
          onDelete={setDeleting}
          onOrderAll={(_g, _w, rs) => setOrdering(rs)}
          onReceive={receive}
        />
      ) : (
        <BomRequestGroups
          requests={visible}
          canDecide={canDecide}
          canManageStock={canManageStock}
          busyIds={busyIds}
          onOrder={(r) => setOrdering([r])}
          onDecline={setDeclining}
          onWithdraw={(r) => act(r, 'withdraw')}
          onReopen={(r) => act(r, 'reopen')}
          onDelete={setDeleting}
          onOrderAll={(_g, _w, rs) => setOrdering(rs)}
          onReceive={receive}
        />
      )}

      {receiving && (
        <ReceiveRollsModal
          materials={materialsQuery.data ?? EMPTY_MATERIALS}
          prefill={receiving}
          onClose={() => setReceiving(null)}
        />
      )}

      {ordering && (
        <PlaceOrderModal requests={ordering} onClose={() => setOrdering(null)} />
      )}

      {cancelling && (
        <ConfirmModal
          title={`Cancel ${cancelling.ref}?`}
          message={`The ${formatMeters(cancelling.ordered_meter)} m order is dropped and its ${cancelling.requests.length === 1 ? 'request goes' : 'requests go'} back to Awaiting.`}
          confirmLabel="Cancel order"
          cancelLabel="Keep order"
          tone="danger"
          onCancel={() => setCancelling(null)}
          onConfirm={() => {
            const order = cancelling;
            setCancelling(null);
            cancelOrder(order);
          }}
        />
      )}

      {declining && (
        <PromptModal
          title={`Decline ${declining.ref}`}
          description={`${formatQty(declining.running_meter)} m × ${formatQty(declining.material_width_mm)} mm of ${declining.material_name}. Production sees this note.`}
          label="Why (optional)"
          example="use the 300 mm stock we already have"
          kind="textarea"
          confirmLabel="Decline request"
          onCancel={() => setDeclining(null)}
          onConfirm={(note) => {
            const request = declining;
            setDeclining(null);
            act(request, 'decline', note);
          }}
        />
      )}

      {deleting && (
        <ConfirmModal
          title={`Delete ${deleting.ref}?`}
          message="This removes the request for good. To keep the record, use Withdraw or Decline instead."
          confirmLabel="Delete for good"
          tone="danger"
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const request = deleting;
            setDeleting(null);
            remove(request);
          }}
        />
      )}
    </div>
  );
}
