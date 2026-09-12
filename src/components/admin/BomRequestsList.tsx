'use client';
// src/components/admin/BomRequestsList.tsx
// The owner's inbox: every "Request" the floor has pressed on the costing
// sheet, newest first, each one reading as a sentence — "Production wants
// 1,200 m × 320 mm of Chromo 80gsm for PO 1187 / PM-442 / Amrut 500ml
// label" — with the expense it was priced at next to the order value it
// was weighed against, and the floor's message underneath.
//
// Two audiences, one list, split by `canDecide`: Admin answers (Order /
// Decline, with an optional note), Production watches, and can withdraw a
// request nobody has answered yet. Polls quietly like the rest of the
// admin panel; paused while a decision prompt is open.

import { useState, useEffect } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { PackageCheck, Ban, Undo2, Trash2, Inbox, MessageSquareText } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, formatQty, formatNumericDate } from '@/lib/utils';
import { formatInr, orderDifference } from '@/lib/bom';
import type { BomMaterialRequestWithJob, BomRequestStatus } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { PromptModal } from './modals';

const POLL_MS = 30_000;

const STATUS_CHIP: Record<BomRequestStatus, string> = {
  pending:   'bg-amber-100 text-amber-800 border-amber-200',
  ordered:   'bg-emerald-100 text-emerald-800 border-emerald-200',
  declined:  'bg-red-100 text-red-700 border-red-200',
  cancelled: 'bg-slate-100 text-slate-600 border-slate-200',
};

const STATUS_LABEL: Record<BomRequestStatus, string> = {
  pending:   'Awaiting Admin',
  ordered:   'Ordered',
  declined:  'Declined',
  cancelled: 'Withdrawn',
};

const FILTERS: { value: string; label: string }[] = [
  { value: 'pending',   label: 'Awaiting Admin' },
  { value: 'ordered',   label: 'Ordered' },
  { value: 'declined',  label: 'Declined' },
  { value: 'cancelled', label: 'Withdrawn' },
  { value: 'all',       label: 'Everything' },
];

const EMPTY: BomMaterialRequestWithJob[] = [];

type Action = 'order' | 'decline' | 'reopen' | 'withdraw';

type Props = { canDecide: boolean };

export default function BomRequestsList({ canDecide }: Props) {
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState('pending');
  const [busyId, setBusyId] = useState<string | null>(null);
  // The request a Decline note prompt is open for. Ordering needs no
  // prompt — the request already says exactly what to order.
  const [declining, setDeclining] = useState<BomMaterialRequestWithJob | null>(null);
  // Delete is armed with a second tap, never a browser dialog.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const requestsQuery = useQuery({
    queryKey: ['bom-requests', filter],
    queryFn: async () => {
      const res  = await fetch(`/api/bom-requests?status=${filter}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load requests');
      return (data.requests ?? []) as BomMaterialRequestWithJob[];
    },
    placeholderData: keepPreviousData,
    refetchInterval: declining ? false : POLL_MS,
  });
  const requests = requestsQuery.data ?? EMPTY;
  const loading  = requestsQuery.isLoading;

  useEffect(() => {
    if (requestsQuery.error) toast.error((requestsQuery.error as Error).message);
  }, [requestsQuery.error]);

  async function act(request: BomMaterialRequestWithJob, action: Action, note?: string) {
    setBusyId(request.id);
    try {
      const res = await fetch(`/api/bom-requests/${request.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action, note }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to update request');
        return;
      }
      // The row's status just changed, which may move it out of the current
      // filter — invalidate every variant rather than patching one in place.
      // The costing sheet's status chip and the nav badge read this too.
      queryClient.invalidateQueries({ queryKey: ['bom-requests'] });
      queryClient.invalidateQueries({ queryKey: ['bom-costings'] });
      const verb: Record<Action, string> = {
        order: 'marked ordered', decline: 'declined', reopen: 'reopened', withdraw: 'withdrawn',
      };
      toast.success(`${request.ref} ${verb[action]}`);
    } catch {
      toast.error('Network error');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(request: BomMaterialRequestWithJob) {
    setBusyId(request.id);
    try {
      const res = await fetch(`/api/bom-requests/${request.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to delete');
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['bom-requests'] });
      queryClient.invalidateQueries({ queryKey: ['bom-costings'] });
      toast.success(`${request.ref} deleted`);
    } catch {
      toast.error('Network error');
    } finally {
      setBusyId(null);
      setConfirmDeleteId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="bom-request-filter" className="sr-only">Filter requests</label>
        <select
          id="bom-request-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className={cn(
            'min-h-11 px-3 rounded-lg text-sm bg-[var(--field-bg)] border border-[var(--field-border)] text-[var(--glass-ink)]',
            'focus:outline-none focus:border-emerald-300/70 focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
          )}
        >
          {FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        {!loading && requests.length > 0 && (
          <p className="text-sm text-[var(--glass-muted)]">
            <strong className="text-[var(--glass-ink)]">{requests.length}</strong>
            {' '}{requests.length === 1 ? 'request' : 'requests'}
          </p>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="space-y-3 rounded-xl glass p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-5 w-28 rounded-full" />
              </div>
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      ) : requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-black/[0.08] bg-white px-4 py-12 text-center">
          <Inbox className="h-6 w-6 text-[var(--glass-muted)]" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-[var(--glass-ink)]">
            {filter === 'pending' ? 'Nothing waiting' : 'Nothing here'}
          </p>
          <p className="mt-1 max-w-sm text-xs text-[var(--glass-muted)]">
            {filter === 'pending'
              ? canDecide
                ? 'No material requests from Production right now.'
                : 'Every request has been answered. Press Request on a costed row when the floor needs material.'
              : 'No requests match this filter.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {requests.map((request) => {
            const busy = busyId === request.id;
            const job  = request.job;
            const difference = orderDifference(request.order_value, request.expense);
            return (
              <li key={request.id} className="rounded-xl glass p-4">
                <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                  <span className="font-mono text-sm font-semibold tabular-nums text-[var(--glass-ink)]">{request.ref}</span>
                  <span className={cn('rounded-md border px-2 py-0.5 text-xs font-medium', STATUS_CHIP[request.status])}>
                    {STATUS_LABEL[request.status]}
                  </span>
                  {job?.sr_no && (
                    <span className="font-mono text-xs font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                      {job.sr_no}
                    </span>
                  )}
                  <div className="flex-1" />
                  <span className="text-xs text-[var(--glass-muted)]">
                    <span className="font-mono tabular-nums">{formatNumericDate(request.created_at)}</span>
                    {request.requested_by ? ` · ${request.requested_by}` : ''}
                  </span>
                </div>

                {/* The request as a sentence — what, how much, for which job */}
                <p className="mt-2 text-sm text-[var(--glass-ink)]">
                  <span className="text-[var(--glass-muted)]">{request.requested_by_department} wants </span>
                  <span className="font-mono font-semibold tabular-nums">{formatQty(request.running_meter)} m</span>
                  <span className="text-[var(--glass-muted)]"> × </span>
                  <span className="font-mono font-semibold tabular-nums">{formatQty(request.material_width_mm)} mm</span>
                  <span className="text-[var(--glass-muted)]"> of </span>
                  <span className="font-semibold">{request.material_name}</span>
                  {job && (
                    <>
                      <span className="text-[var(--glass-muted)]"> for </span>
                      <span className="font-semibold">{job.party}</span>
                      <span className="text-[var(--glass-muted)]">
                        {job.po_no ? <> · PO <span className="font-mono">{job.po_no}</span></> : null}
                        {job.pm_code ? <> · <span className="font-mono">{job.pm_code}</span></> : null}
                        {job.material_name ? <> · {job.material_name}</> : null}
                      </span>
                    </>
                  )}
                </p>

                <dl className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
                  <div className="flex items-baseline gap-1.5">
                    <dt className="text-[var(--glass-muted)]">Expense</dt>
                    <dd className="font-mono font-semibold tabular-nums text-[var(--glass-ink)]">
                      ₹{formatInr(request.expense)}
                      <span className="ml-1 font-normal text-[var(--glass-muted)]">@ ₹{formatInr(request.rate_per_sqm)}/m²</span>
                    </dd>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <dt className="text-[var(--glass-muted)]">Order value</dt>
                    <dd className="font-mono font-semibold tabular-nums text-[var(--glass-ink)]">₹{formatInr(request.order_value)}</dd>
                  </div>
                  {difference !== null && (
                    <div className="flex items-baseline gap-1.5">
                      <dt className="text-[var(--glass-muted)]">Difference</dt>
                      <dd className={cn('font-mono font-semibold tabular-nums', difference < 0 ? 'text-red-700' : 'text-emerald-800')}>
                        {difference < 0 ? '−' : ''}₹{formatInr(Math.abs(difference))}
                      </dd>
                    </div>
                  )}
                </dl>

                {request.message && (
                  <p className="mt-2 flex items-start gap-1.5 whitespace-pre-wrap rounded-lg border border-black/[0.06] bg-[#F4F8F5] px-3 py-2 text-xs text-[var(--glass-ink)]">
                    <MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--glass-muted)]" aria-hidden="true" />
                    <span>{request.message}</span>
                  </p>
                )}

                {request.decided_at && request.status !== 'pending' && request.status !== 'cancelled' && (
                  <p className="mt-2 text-xs text-[var(--glass-muted)]">
                    {STATUS_LABEL[request.status]}{' '}
                    <span className="font-mono tabular-nums">{formatNumericDate(request.decided_at)}</span>
                    {request.decided_by ? ` by ${request.decided_by}` : ''}
                    {request.decision_note ? <> — <span className="text-[var(--glass-ink)]">{request.decision_note}</span></> : null}
                  </p>
                )}

                {/* Actions */}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {canDecide && request.status === 'pending' && (
                    <>
                      <Button intent="tinted" size="sm" icon={PackageCheck} busy={busy} onClick={() => act(request, 'order')}>
                        Order
                      </Button>
                      <Button intent="danger" size="sm" icon={Ban} disabled={busy} onClick={() => setDeclining(request)}>
                        Decline
                      </Button>
                    </>
                  )}
                  {canDecide && (request.status === 'ordered' || request.status === 'declined') && (
                    <Button size="sm" icon={Undo2} busy={busy} onClick={() => act(request, 'reopen')}>
                      Undo
                    </Button>
                  )}
                  {request.status === 'pending' && (
                    <Button size="sm" busy={busy} onClick={() => act(request, 'withdraw')}>
                      Withdraw
                    </Button>
                  )}

                  <div className="flex-1" />

                  {canDecide && (
                    confirmDeleteId === request.id ? (
                      <>
                        <Button intent="danger" size="sm" busy={busy} onClick={() => remove(request)}>Delete for good</Button>
                        <Button size="sm" onClick={() => setConfirmDeleteId(null)}>Keep</Button>
                      </>
                    ) : (
                      <Button
                        intent="danger"
                        size="sm"
                        icon={Trash2}
                        aria-label={`Delete ${request.ref} permanently`}
                        title="Delete permanently — use Withdraw or Decline to keep the record"
                        onClick={() => setConfirmDeleteId(request.id)}
                      />
                    )
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {declining && (
        <PromptModal
          title={`Decline ${declining.ref}`}
          description={`${formatQty(declining.running_meter)} m × ${formatQty(declining.material_width_mm)} mm of ${declining.material_name}. Production sees this note.`}
          label="Why (optional)"
          kind="textarea"
          placeholder="e.g. use the 300 mm stock we already have"
          confirmLabel="Decline request"
          onCancel={() => setDeclining(null)}
          onConfirm={(note) => {
            const request = declining;
            setDeclining(null);
            act(request, 'decline', note);
          }}
        />
      )}
    </div>
  );
}
