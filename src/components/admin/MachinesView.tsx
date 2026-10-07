'use client';
// src/components/admin/MachinesView.tsx
// /admin/machines — every machine as a card (state, run speed, the job on it,
// how far through), the chosen machine's queue with drag-to-reorder, and the
// month's utilisation beside it.
//
// Reads the same ['machines', ''] query as the dashboard strip and board, so
// a Start on one screen shows on the others at the next refetch. Production
// and Admin can change things; everyone else gets the same page read-only.
//
// Reordering is a pointer drag on the handle (mouse and touch alike), or the
// arrow keys with the handle focused. The new order shows at once and is
// saved in one request; if the server refuses — someone else changed the
// queue meanwhile — the real order comes back rather than the guessed one.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { Check, GripVertical, Monitor, Play, Plus, X } from 'lucide-react';
import { cn, formatQty } from '@/lib/utils';
import { formatDuration, runDurationMs } from '@/lib/machineSpeed';
import { machineSnapshot, moveItem, queueOffsetsMs, type MachineSnapshot } from '@/lib/machineQueue';
import { JOBS_CHANGED_EVENT } from '@/lib/constants/events';
import type { Machine, MachineQueueItem, MachineUtilisationReport } from '@/lib/types';
import { Skeleton } from '@/components/ui/Skeleton';
import { ConfirmModal, ModalShell } from './modals';

type AvailableJob = { id: string; po_number: string; job_name: string | null; party: string; label_qty: number | null };
type BoardData = { machines: Machine[]; queue: MachineQueueItem[]; available_jobs: AvailableJob[] };
type Mutate = (fn: () => Promise<Response>, okMsg?: string) => Promise<boolean>;

const btnPrimary = 'inline-flex min-h-11 items-center gap-2 rounded-[10px] bg-brand-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-primary-hover disabled:opacity-40';
const btnGhost   = 'inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-brand-border bg-white px-3.5 text-sm font-medium text-brand-ink transition-colors hover:bg-brand-surface-hover disabled:opacity-40';
const fieldCls   = 'h-11 w-full rounded-[10px] border border-brand-border bg-white px-3 text-sm normal-case tracking-normal text-brand-ink focus:border-brand-primary focus:outline-none focus:shadow-[0_0_0_4px_rgba(16,85,63,0.14)]';
const lblCls     = 'flex flex-col gap-1.5 text-[10px] font-medium uppercase tracking-[0.025em] text-brand-muted';

/** "14:20" today, "06 Oct 02:24" on any other day. */
const etaLabel = (ms: number, now: number) =>
  format(new Date(ms), new Date(ms).toDateString() === new Date(now).toDateString() ? 'HH:mm' : 'dd MMM HH:mm');

const STATE = {
  running: { label: 'Running',     dot: 'bg-[#10B981] shadow-[0_0_0_4px_rgba(16,185,129,0.18)]', text: 'text-brand-success' },
  idle:    { label: 'Idle',        dot: 'bg-[#F59E0B]',                                           text: 'text-brand-warning' },
  down:    { label: 'Not working', dot: 'bg-[#B91C1C]',                                           text: 'text-brand-danger' },
} as const;

type Props = {
  canManage:   boolean;
  utilisation: MachineUtilisationReport;
};

export default function MachinesView({ canManage, utilisation }: Props) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['machines', ''],
    queryFn: async () => {
      const res = await fetch('/api/machines');
      if (!res.ok) throw new Error('Failed to load machines');
      return (await res.json()) as BoardData;
    },
    refetchInterval: 60_000,
  });

  // Progress is read against the clock; tick between refetches.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const [busy, setBusy]           = useState(false);
  const [selectedId, setSelected] = useState<string | null>(null);
  const [adding, setAdding]       = useState(false);

  const machines = useMemo(() => (query.data?.machines ?? []).filter((m) => !m.is_retired), [query.data]);
  const queue    = useMemo(() => query.data?.queue ?? [], [query.data]);
  const snaps    = useMemo(() => new Map(machines.map((m) => [m.id, machineSnapshot(m, queue, now)])), [machines, queue, now]);
  const queuedAnywhere = useMemo(() => new Set(queue.map((q) => q.job_id)), [queue]);

  // Default to the first running machine, else the first one; keep the choice
  // while it still exists.
  const selected =
    machines.find((m) => m.id === selectedId)
    ?? machines.find((m) => snaps.get(m.id)?.state === 'running')
    ?? machines[0]
    ?? null;

  const running = machines.filter((m) => snaps.get(m.id)?.state === 'running').length;
  const waiting = queue.filter((q) => q.status === 'queued').length;

  const mutate: Mutate = async (fn, okMsg) => {
    setBusy(true);
    try {
      const res  = await fn();
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? 'Something went wrong');
        await queryClient.invalidateQueries({ queryKey: ['machines'] });
        return false;
      }
      // Start / Complete move the job's stage too — same report as the board.
      const sync = body.stage_sync as { advanced: true; stage: string } | { advanced: false; reason: string } | undefined;
      if (okMsg) toast.success(sync?.advanced ? `${okMsg} · job moved to ${sync.stage}` : okMsg);
      if (sync && !sync.advanced) toast(`Stage unchanged — ${sync.reason}`, { icon: '⚠️' });
      await queryClient.invalidateQueries({ queryKey: ['machines'] });
      if (sync?.advanced) window.dispatchEvent(new Event(JOBS_CHANGED_EVENT));
      return true;
    } catch {
      toast.error('Network error. Try again.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[30px] font-semibold leading-9 tracking-[-0.025em] text-brand-ink">Machines</h1>
          <p className="text-sm text-brand-muted">
            {query.data ? (
              machines.length === 0 ? 'No machines on the board yet.' : (
                <>
                  <span className="font-mono font-semibold text-brand-ink">{running}</span> of {machines.length} running
                  {' · '}queue holds <span className="font-mono">{waiting}</span> {waiting === 1 ? 'job' : 'jobs'}
                </>
              )
            ) : 'Loading the machines…'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/display" target="_blank" rel="noopener" className={btnGhost}>
            <Monitor className="h-4 w-4" aria-hidden="true" />
            Open wall display
          </Link>
          {canManage && (
            <button type="button" onClick={() => setAdding(true)} className={btnPrimary}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add machine
            </button>
          )}
        </div>
      </div>

      {/* Machine cards */}
      {query.isPending ? (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr))]" role="status" aria-label="Loading machines">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-3 rounded-[14px] border border-brand-border bg-white p-[18px]">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-3 w-48" />
              <Skeleton className="h-1.5 w-full" />
            </div>
          ))}
        </div>
      ) : query.isError ? (
        <p className="rounded-2xl border border-brand-border bg-white px-5 py-4 text-sm text-brand-muted">
          Couldn&rsquo;t load the machines. It retries every minute.
        </p>
      ) : machines.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-brand-border bg-white px-5 py-12 text-center">
          <p className="text-sm font-medium text-brand-ink">No machines yet.</p>
          <p className="text-sm text-brand-muted">
            {canManage ? 'Add each press and slitter so jobs can be queued on them.' : 'Production adds the presses here.'}
          </p>
        </div>
      ) : (
        <div role="group" aria-label="Machines" className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr))]">
          {machines.map((m) => (
            <MachineCard
              key={m.id}
              machine={m}
              snap={snaps.get(m.id)!}
              selected={selected?.id === m.id}
              onSelect={() => setSelected(m.id)}
            />
          ))}
        </div>
      )}

      {selected && (
        <div className="flex flex-wrap items-start gap-5">
          <QueueCard
            key={selected.id}
            machine={selected}
            snap={snaps.get(selected.id)!}
            now={now}
            availableJobs={query.data?.available_jobs ?? []}
            queuedAnywhere={queuedAnywhere}
            canManage={canManage}
            busy={busy}
            mutate={mutate}
          />
          <UtilisationCard report={utilisation} />
        </div>
      )}

      {adding && <AddMachineDialog busy={busy} mutate={mutate} onClose={() => setAdding(false)} />}
    </div>
  );
}

// ── One machine card ──────────────────────────────────────────

function MachineCard({ machine, snap, selected, onSelect }: {
  machine: Machine; snap: MachineSnapshot; selected: boolean; onSelect: () => void;
}) {
  const st   = STATE[snap.state];
  const job  = snap.printing?.jobs ?? null;
  const next = snap.queued[0]?.jobs ?? null;
  const qty  = job?.label_qty ?? null;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex flex-col gap-3 rounded-[14px] border bg-white p-[18px] text-left text-brand-ink transition-shadow motion-reduce:transition-none',
        selected
          ? 'border-2 border-brand-primary p-[17px] shadow-[0_0_0_4px_rgba(16,85,63,0.08)]'
          : 'border-brand-border hover:shadow-[0_2px_8px_rgba(12,42,32,0.06)]',
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-base font-semibold">{machine.name}</span>
        {machine.location && <span className="shrink-0 text-xs text-brand-muted">{machine.location}</span>}
      </span>

      <span className="flex items-center gap-2 text-[13px]">
        <span aria-hidden="true" className={cn('h-2 w-2 shrink-0 rounded-full', st.dot)} />
        <span className={cn('font-semibold', st.text)}>{st.label}</span>
        <span className="text-brand-muted">
          · {machine.labels_per_hour ? <><span className="font-mono">{formatQty(machine.labels_per_hour)}</span>/h</> : 'no run speed set'}
        </span>
      </span>

      <span className="min-h-5 truncate text-sm">
        {job ? (
          <><span className="font-mono font-semibold">{job.po_number}</span> <span className="text-brand-muted">{job.party}</span></>
        ) : next ? (
          <span className="text-brand-muted">Next: <span className="font-mono text-brand-ink">{next.po_number}</span> {next.party}</span>
        ) : (
          <span className="text-brand-muted">Queue empty</span>
        )}
      </span>

      <span
        className="block h-1.5 overflow-hidden rounded-full bg-brand-sunken"
        role={snap.pct != null ? 'progressbar' : undefined}
        aria-valuenow={snap.pct ?? undefined}
        aria-valuemin={snap.pct != null ? 0 : undefined}
        aria-valuemax={snap.pct != null ? 100 : undefined}
        aria-label={snap.pct != null ? `About ${snap.pct}% through the run` : undefined}
      >
        <span className="block h-full rounded-full bg-brand-primary" style={{ width: `${snap.pct ?? 0}%` }} />
      </span>

      <span className="flex justify-between gap-2 text-xs text-brand-muted">
        <span className="font-mono">
          {snap.doneQty != null && qty != null
            ? `${formatQty(snap.doneQty)} / ${formatQty(qty)}`
            : snap.printing
              ? 'printing'
              : '—'}
        </span>
        <span><span className="font-mono">{snap.queued.length}</span> queued</span>
      </span>
    </button>
  );
}

// ── The chosen machine's queue ────────────────────────────────

function QueueCard({ machine, snap, now, availableJobs, queuedAnywhere, canManage, busy, mutate }: {
  machine:        Machine;
  snap:           MachineSnapshot;
  now:            number;
  availableJobs:  AvailableJob[];
  queuedAnywhere: Set<string>;
  canManage:      boolean;
  busy:           boolean;
  mutate:         Mutate;
}) {
  const headingId = useId();
  const [adding, setAdding]               = useState(false);
  const [confirmItem, setConfirmItem]     = useState<MachineQueueItem | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [editingRate, setEditingRate]     = useState(false);

  // Local order while dragging / saving; null = follow the server.
  const [order, setOrder] = useState<string[] | null>(null);
  const serverIds = snap.queued.map((q) => q.id).join(',');
  useEffect(() => { setOrder(null); }, [serverIds]);

  const byId   = new Map(snap.queued.map((q) => [q.id, q]));
  const ids    = order ?? snap.queued.map((q) => q.id);
  const rows   = ids.map((id) => byId.get(id)).filter((q): q is MachineQueueItem => !!q);
  const remain = snap.etaMs != null ? Math.max(0, snap.etaMs - now) : 0;
  const starts = queueOffsetsMs(rows, machine.labels_per_hour, remain);

  async function saveOrder(next: string[]) {
    if (next.join(',') === serverIds) { setOrder(null); return; }
    setOrder(next);
    const ok = await mutate(
      () => fetch(`/api/machines/${machine.id}/queue`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: next }),
      }),
    );
    if (!ok) setOrder(null);
  }

  const itemPatch = (item: MachineQueueItem, body: Record<string, unknown>, okMsg?: string) =>
    mutate(() => fetch(`/api/machines/${machine.id}/queue/${item.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }), okMsg);

  // ── pointer drag ──
  const listRef = useRef<HTMLOListElement>(null);
  const drag    = useRef<{ id: string; pointerId: number } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  function onHandleDown(e: React.PointerEvent<HTMLButtonElement>, id: string) {
    if (!canManage || busy || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id, pointerId: e.pointerId };
    setDragId(id);
    setOrder(ids);
  }

  function onHandleMove(e: React.PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId || !listRef.current) return;
    const items = Array.from(listRef.current.querySelectorAll<HTMLElement>('li[data-qid]'));
    const from  = ids.indexOf(d.id);
    // Target = the first row whose midpoint is below the pointer.
    let to = items.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    if (to === -1) to = items.length - 1;
    else if (to > from) to -= 1;
    if (to !== from) setOrder(moveItem(ids, from, to));
  }

  function onHandleUp(e: React.PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    setDragId(null);
    saveOrder(ids);
  }

  function onHandleKey(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!canManage || busy) return;
    const to = e.key === 'ArrowUp' ? index - 1 : e.key === 'ArrowDown' ? index + 1 : null;
    if (to === null || to < 0 || to >= ids.length) return;
    e.preventDefault();
    const moved = ids[index];
    saveOrder(moveItem(ids, index, to));
    // Keep focus on the moved row's handle after it re-renders.
    requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLButtonElement>(`button[data-qid="${moved}"]`)?.focus();
    });
  }

  const printing = snap.printing;
  const blocked  = !machine.is_active;

  return (
    <section
      aria-labelledby={headingId}
      className="min-w-0 flex-[999_1_640px] overflow-hidden rounded-2xl border border-brand-border bg-white shadow-[0_2px_8px_rgba(12,42,32,0.04)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3.5 pt-[18px]">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={headingId} className="text-base font-semibold text-brand-ink">{machine.name} · queue</h2>
          <span className="text-[13px] text-brand-muted">
            {canManage ? 'Drag to reorder. The wall display follows this order.' : 'In print order. The wall display follows this order.'}
          </span>
        </div>
        {canManage && (
          <button type="button" onClick={() => setAdding(true)} disabled={busy} className={btnGhost}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add to queue
          </button>
        )}
      </div>

      {/* Machine controls */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-brand-line-soft px-5 py-1.5 text-[13px] text-brand-muted">
        {editingRate ? (
          <RateEditor machine={machine} busy={busy} mutate={mutate} onDone={() => setEditingRate(false)} />
        ) : (
          <span className="flex min-h-10 items-center gap-1.5">
            Run speed
            {machine.labels_per_hour
              ? <span className="font-mono text-brand-ink">{formatQty(machine.labels_per_hour)}/h</span>
              : <span className="text-brand-ink">not set</span>}
            {canManage && (
              <button type="button" onClick={() => setEditingRate(true)} className="min-h-10 rounded-lg px-2 font-semibold text-brand-primary hover:bg-brand-surface-hover">
                Change
              </button>
            )}
          </span>
        )}
        <Link
          href={`/display/${machine.id}`}
          target="_blank"
          rel="noopener"
          className="flex min-h-10 items-center gap-1.5 rounded-lg px-2 font-semibold text-brand-primary hover:bg-brand-surface-hover"
        >
          <Monitor className="h-3.5 w-3.5" aria-hidden="true" />
          Room display
        </Link>
        {canManage && (
          <span className="ml-auto flex flex-wrap gap-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => mutate(() => fetch(`/api/machines/${machine.id}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_active: !machine.is_active }),
              }), machine.is_active ? `${machine.name} marked as not working` : `${machine.name} back in service`)}
              className="min-h-10 rounded-lg px-2.5 font-medium text-brand-ink hover:bg-brand-surface-hover disabled:opacity-40"
            >
              {machine.is_active ? 'Mark not working' : 'Mark working'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmRemove(true)}
              className="min-h-10 rounded-lg px-2.5 font-medium text-brand-danger hover:bg-red-50 disabled:opacity-40"
            >
              Remove machine
            </button>
          </span>
        )}
      </div>

      {printing && (
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-t border-brand-line-soft bg-brand-surface-alt py-3.5 pl-2 pr-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center" aria-hidden="true">
            <span className="h-2 w-2 rounded-full bg-[#10B981] shadow-[0_0_0_4px_rgba(16,185,129,0.18)]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-brand-ink">Printing now · {printing.jobs?.party}</p>
            <p className="truncate text-[13px] text-brand-muted">
              <span className="font-mono">{printing.jobs?.po_number}</span>
              {printing.jobs?.job_name && ` · ${printing.jobs.job_name}`}
              {printing.started_at && <> · started <span className="font-mono">{format(new Date(printing.started_at), 'HH:mm')}</span></>}
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-sm font-semibold text-brand-ink">
              {printing.jobs?.label_qty != null ? formatQty(printing.jobs.label_qty) : '—'}
            </p>
            <p className="font-mono text-xs text-brand-muted">
              {snap.etaMs ? `ETA ${etaLabel(snap.etaMs, now)}` : ''}
            </p>
          </div>
          {canManage && (
            <button
              type="button"
              disabled={busy}
              onClick={() => itemPatch(printing, { action: 'complete' }, 'Marked completed')}
              className={btnGhost}
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              Complete
            </button>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="border-t border-brand-line-soft px-5 py-8 text-center text-sm text-brand-muted">
          {printing ? 'Nothing waiting after this job.' : 'Nothing queued on this machine.'}
          {canManage && ' Add a job whose job card is done.'}
        </p>
      ) : (
        <ol ref={listRef} aria-label={`${machine.name} waiting jobs`}>
          {rows.map((q, i) => {
            const pri     = q.jobs?.urgent_priority ?? null;
            const run     = runDurationMs(q.jobs?.label_qty, machine.labels_per_hour);
            // When this one should start: after everything above it.
            const before  = i === 0 ? remain : starts[i - 1];
            const startAt = before != null && (i > 0 || printing) ? now + before : null;
            return (
              <li
                key={q.id}
                data-qid={q.id}
                className={cn(
                  'flex items-center gap-3.5 border-t border-brand-line-soft py-3.5 pl-2 pr-4',
                  dragId === q.id && 'relative z-10 bg-white shadow-[0_8px_24px_rgba(12,42,32,0.14)]',
                )}
              >
                {canManage ? (
                  <button
                    type="button"
                    data-qid={q.id}
                    aria-label={`Reorder ${q.jobs?.po_number ?? 'job'}, position ${i + 1} of ${rows.length}. Use the up and down arrow keys.`}
                    onPointerDown={(e) => onHandleDown(e, q.id)}
                    onPointerMove={onHandleMove}
                    onPointerUp={onHandleUp}
                    onPointerCancel={onHandleUp}
                    onKeyDown={(e) => onHandleKey(e, i)}
                    disabled={busy}
                    className={cn(
                      'flex h-11 w-11 shrink-0 touch-none items-center justify-center rounded-lg text-brand-faint hover:bg-brand-surface-hover hover:text-brand-ink disabled:opacity-40',
                      dragId === q.id ? 'cursor-grabbing' : 'cursor-grab',
                    )}
                  >
                    <GripVertical className="h-4 w-4" aria-hidden="true" />
                  </button>
                ) : (
                  <span className="w-3" aria-hidden="true" />
                )}
                <span className="w-[18px] shrink-0 font-mono text-[13px] text-brand-muted">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-brand-ink">
                    {q.jobs?.party}
                    {pri != null && (
                      <span className={cn('ml-1.5 font-mono text-[11px] font-semibold tracking-[0.04em]', pri === 1 ? 'text-brand-danger' : 'text-brand-muted')}>
                        P{pri}
                      </span>
                    )}
                  </p>
                  <p className="truncate text-[13px] text-brand-muted">
                    <span className="font-mono">{q.jobs?.po_number}</span>
                    {q.jobs?.job_name && ` · ${q.jobs.job_name}`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm font-semibold text-brand-ink">
                    {q.jobs?.label_qty != null ? formatQty(q.jobs.label_qty) : '—'}
                  </p>
                  <p
                    className="font-mono text-xs text-brand-muted"
                    title={startAt ? `Starts about ${format(new Date(startAt), 'dd MMM, HH:mm')}` : undefined}
                  >
                    {run ? `~${formatDuration(run)}` : '—'}
                  </p>
                </div>
                {canManage && (
                  <span className="flex shrink-0 items-center gap-1">
                    {i === 0 && !printing && (
                      <button
                        type="button"
                        disabled={busy || blocked}
                        title={blocked ? 'Machine is marked as not working' : 'Start printing (stamps the time)'}
                        onClick={() => itemPatch(q, { action: 'start' }, 'Started — time noted')}
                        className={btnPrimary}
                      >
                        <Play className="h-4 w-4" aria-hidden="true" />
                        Start
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirmItem(q)}
                      aria-label={`Remove ${q.jobs?.po_number ?? 'job'} from the queue`}
                      className="flex h-11 w-11 items-center justify-center rounded-lg text-brand-faint hover:bg-red-50 hover:text-brand-danger disabled:opacity-40"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {adding && (
        <AddToQueueDialog
          machine={machine}
          jobs={availableJobs.filter((j) => !queuedAnywhere.has(j.id))}
          busy={busy}
          mutate={mutate}
          onClose={() => setAdding(false)}
        />
      )}
      {confirmItem && (
        <ConfirmModal
          title="Remove from queue?"
          message={`Take ${confirmItem.jobs?.po_number ?? 'this job'} off ${machine.name}'s queue. The job itself is not changed.`}
          confirmLabel="Remove"
          tone="danger"
          busy={busy}
          onCancel={() => setConfirmItem(null)}
          onConfirm={() => {
            const it = confirmItem;
            setConfirmItem(null);
            mutate(() => fetch(`/api/machines/${machine.id}/queue/${it.id}`, { method: 'DELETE' }), 'Removed from queue');
          }}
        />
      )}
      {confirmRemove && (
        <ConfirmModal
          title={`Remove "${machine.name}"?`}
          message="This takes the machine off the board. Its printing history is kept."
          confirmLabel="Remove machine"
          tone="danger"
          busy={busy}
          onCancel={() => setConfirmRemove(false)}
          onConfirm={() => {
            setConfirmRemove(false);
            mutate(() => fetch(`/api/machines/${machine.id}`, { method: 'DELETE' }), `${machine.name} removed`);
          }}
        />
      )}
    </section>
  );
}

function RateEditor({ machine, busy, mutate, onDone }: {
  machine: Machine; busy: boolean; mutate: Mutate; onDone: () => void;
}) {
  const [value, setValue] = useState(machine.labels_per_hour ? String(machine.labels_per_hour) : '');
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const ok = await mutate(() => fetch(`/api/machines/${machine.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ labels_per_hour: value === '' ? null : value }),
    }), value === '' ? 'Run speed cleared' : 'Run speed saved');
    if (ok) onDone();
  }
  return (
    <form onSubmit={save} className="flex flex-wrap items-center gap-2 py-1">
      <label className="flex items-center gap-2">
        Run speed
        <input
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ''))}
          inputMode="numeric"
          autoFocus
          aria-label={`Labels per hour for ${machine.name}`}
          className="h-10 w-28 rounded-lg border border-brand-border px-2 font-mono text-sm text-brand-ink focus:border-brand-primary focus:outline-none"
        />
        labels/h
      </label>
      <button type="submit" disabled={busy} className="min-h-10 rounded-lg bg-brand-primary px-3 font-semibold text-white disabled:opacity-40">Save</button>
      <button type="button" onClick={onDone} className="min-h-10 rounded-lg px-3 font-medium text-brand-ink hover:bg-brand-surface-hover">Cancel</button>
    </form>
  );
}

// ── Utilisation ───────────────────────────────────────────────

function UtilisationCard({ report }: { report: MachineUtilisationReport }) {
  const days  = Math.round((Date.parse(`${report.to}T00:00:00Z`) - Date.parse(`${report.from}T00:00:00Z`)) / 86_400_000) + 1;
  const hours = days * 24;
  const rows  = [...report.machines].sort((a, b) => (b.utilisation_pct ?? 0) - (a.utilisation_pct ?? 0));

  return (
    <section
      aria-labelledby="util-title"
      className="flex min-w-0 flex-[1_1_340px] flex-col gap-4 rounded-2xl border border-brand-border bg-white p-5 shadow-[0_2px_8px_rgba(12,42,32,0.04)]"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="util-title" className="text-base font-semibold text-brand-ink">Utilisation</h2>
        <span className="font-mono text-xs uppercase text-brand-muted">
          {format(new Date(`${report.from}T00:00:00`), 'MMM yyyy')}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-brand-muted">No machines to report on.</p>
      ) : rows.map((m) => {
        const pct = m.utilisation_pct ?? 0;
        return (
          <div key={m.machine_id} className="flex flex-col gap-1.5">
            <div className="flex justify-between gap-2 text-sm text-brand-ink">
              <span className="truncate">{m.machine_name}</span>
              <span className="font-mono font-semibold">{Math.round(pct)}%</span>
            </div>
            <span className="block h-2.5 overflow-hidden rounded-full bg-brand-sunken" aria-hidden="true">
              <span className="block h-full rounded-full bg-brand-primary" style={{ width: `${Math.min(100, pct)}%` }} />
            </span>
            <span className="font-mono text-xs text-brand-muted">
              {Math.round(m.printing_ms / 3_600_000)} of {hours} h · {m.jobs_completed} {m.jobs_completed === 1 ? 'run' : 'runs'}
            </span>
          </div>
        );
      })}
      <p className="text-xs leading-normal text-brand-muted">
        Printing hours ÷ every hour of the month so far, nights included. Run times come from Start and Complete.
      </p>
    </section>
  );
}

// ── Dialogs ───────────────────────────────────────────────────

function AddMachineDialog({ busy, mutate, onClose }: { busy: boolean; mutate: Mutate; onClose: () => void }) {
  const titleId = useId();
  const [name, setName]         = useState('');
  const [location, setLocation] = useState('');
  const [rate, setRate]         = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { toast.error('Give the machine a name'); return; }
    const ok = await mutate(() => fetch('/api/machines', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, location, labels_per_hour: rate }),
    }), 'Machine added');
    if (ok) onClose();
  }

  return (
    <ModalShell titleId={titleId} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4 p-6">
        <h3 id={titleId} className="text-base font-semibold text-[var(--glass-ink)]">Add machine</h3>
        <label className={lblCls}>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Flexo Press 3" className={fieldCls} autoFocus /></label>
        <label className={lblCls}>Room or location (optional)<input value={location} onChange={(e) => setLocation(e.target.value)} className={fieldCls} /></label>
        <label className={lblCls}>
          Run speed, labels per hour (optional)
          <input value={rate} onChange={(e) => setRate(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" className={cn(fieldCls, 'font-mono')} />
          <span className="text-xs normal-case tracking-normal text-brand-muted">Used to work out finish times and progress.</span>
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnGhost}>Cancel</button>
          <button type="submit" disabled={busy} className={btnPrimary}>{busy ? 'Adding…' : 'Add machine'}</button>
        </div>
      </form>
    </ModalShell>
  );
}

function AddToQueueDialog({ machine, jobs, busy, mutate, onClose }: {
  machine: Machine; jobs: AvailableJob[]; busy: boolean; mutate: Mutate; onClose: () => void;
}) {
  const titleId = useId();
  const [jobId, setJobId] = useState('');
  const picked = jobs.find((j) => j.id === jobId) ?? null;
  const run    = runDurationMs(picked?.label_qty, machine.labels_per_hour);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!jobId) { toast.error('Pick a job first'); return; }
    const ok = await mutate(() => fetch(`/api/machines/${machine.id}/queue`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId }),
    }), 'Job queued');
    if (ok) onClose();
  }

  return (
    <ModalShell titleId={titleId} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1">
          <h3 id={titleId} className="text-base font-semibold text-[var(--glass-ink)]">Add to {machine.name}</h3>
          <p className="text-sm text-[var(--glass-muted)]">It goes to the end of the queue. Drag it up afterwards if it&rsquo;s more urgent.</p>
        </div>
        <label className={lblCls}>
          Job
          <select value={jobId} onChange={(e) => setJobId(e.target.value)} className={fieldCls} autoFocus>
            <option value="">Select a job…</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.po_number} — {j.job_name ?? j.party}{j.label_qty != null ? ` (${formatQty(j.label_qty)})` : ''}
              </option>
            ))}
          </select>
        </label>
        {jobs.length === 0 && (
          <p className="text-sm text-brand-warning">
            No jobs ready. A job shows here once Prepress completes Job Card Done, and leaves once it&rsquo;s queued on a machine.
          </p>
        )}
        {run != null && (
          <p className="text-sm text-[var(--glass-muted)]">
            About <span className="font-mono text-[var(--glass-ink)]">{formatDuration(run)}</span> at{' '}
            <span className="font-mono">{formatQty(machine.labels_per_hour)}</span>/h.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnGhost}>Cancel</button>
          <button type="submit" disabled={busy || !jobId} className={btnPrimary}>{busy ? 'Adding…' : 'Add to queue'}</button>
        </div>
      </form>
    </ModalShell>
  );
}
