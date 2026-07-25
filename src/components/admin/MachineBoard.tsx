'use client';
// src/components/admin/MachineBoard.tsx
// Live production board on the dashboard: which job is printing on which
// machine right now and what comes next.
//   • Machines are dynamic — Production/Admin add, mark faulty, or remove
//     them (machines with history are retired, never deleted).
//   • Each machine has an editable queue: Production picks jobs from the
//     open jobs list, in sequence, with estimated start/finish times.
//   • Start/Complete stamp the actual times automatically; completed items
//     leave the queue and become permanent history, browsable by date.
//   • Unfinished jobs stay queued — they carry forward to the next day.
// Other departments see the board read-only. Refreshes every 60 s.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { format } from 'date-fns';
import { Check, X, Play, Pencil, ArrowUp, ArrowDown, MoreHorizontal, Monitor, Gauge } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, formatQty } from '@/lib/utils';
import { runDurationMs, formatDuration, estimateFinishIso } from '@/lib/machineSpeed';
import { JOBS_CHANGED_EVENT } from '@/lib/constants/events';
import type { Department } from '@/lib/constants/departments';
import type { Machine, MachineQueueItem } from '@/lib/types';
import { ConfirmModal } from './modals';
import { Skeleton } from '@/components/ui/Skeleton';

type AvailableJob = {
  id:        string;
  po_number: string;
  job_name:  string | null;
  party:     string;
  label_qty: number | null;
};

type BoardData = {
  machines:       Machine[];
  queue:          MachineQueueItem[];
  available_jobs: AvailableJob[];
  history:        MachineQueueItem[] | null;
};

const fmtDT = (iso: string | null) =>
  iso ? format(new Date(iso), 'dd MMM, h:mm aa') : '—';

const toIsoOrNull = (local: string) =>
  local ? new Date(local).toISOString() : null;

export default function MachineBoard({ dept }: { dept: Department }) {
  const canManage = dept === 'Production' || dept === 'Admin';

  const [data, setData]               = useState<BoardData | null>(null);
  const [historyDate, setHistoryDate] = useState('');
  const [busy, setBusy]               = useState(false);
  const [showAddMachine, setShowAddMachine] = useState(false);
  const [machineName, setMachineName]       = useState('');
  const [machineLocation, setMachineLocation] = useState('');
  const [machineRate, setMachineRate]         = useState('');
  const [confirmRemove, setConfirmRemove]   = useState<Machine | null>(null);

  const load = useCallback(async (date: string) => {
    try {
      const res = await fetch(`/api/machines${date ? `?date=${date}` : ''}`);
      if (res.ok) setData(await res.json());
    } catch {
      // network hiccup — keep showing the last board
    }
  }, []);

  useEffect(() => {
    load(historyDate);
    const t = setInterval(() => load(historyDate), 60_000);
    return () => clearInterval(t);
  }, [load, historyDate]);

  async function mutate(fn: () => Promise<Response>, okMsg?: string): Promise<boolean> {
    setBusy(true);
    try {
      const res  = await fn();
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? 'Something went wrong');
        return false;
      }
      // Start / Complete also move the job's stage. Say so in the same toast so
      // Production can see the second half of the work was recorded — and say
      // it plainly when it wasn't, since then they still must set it by hand.
      const sync = body.stage_sync as
        | { advanced: true;  stage:  string }
        | { advanced: false; reason: string }
        | undefined;

      if (okMsg) {
        toast.success(sync?.advanced ? `${okMsg} · job moved to ${sync.stage}` : okMsg);
      }
      if (sync && !sync.advanced) {
        toast(`Stage unchanged — ${sync.reason}`, { icon: '⚠️' });
      }

      await load(historyDate);
      // The jobs table keeps its own copy of the list; tell it to refetch so an
      // auto-advanced stage appears without a page reload.
      if (sync?.advanced) {
        window.dispatchEvent(new Event(JOBS_CHANGED_EVENT));
      }
      return true;
    } catch {
      toast.error('Network error. Try again.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addMachine() {
    if (!machineName.trim()) { toast.error('Machine name is required'); return; }
    const ok = await mutate(
      () => fetch('/api/machines', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:            machineName,
          location:        machineLocation,
          labels_per_hour: machineRate,
        }),
      }),
      'Machine added'
    );
    if (ok) {
      setMachineName('');
      setMachineLocation('');
      setMachineRate('');
      setShowAddMachine(false);
    }
  }

  function removeMachine(m: Machine) {
    mutate(
      () => fetch(`/api/machines/${m.id}`, { method: 'DELETE' }),
      `${m.name} removed`
    );
  }

  function toggleFault(m: Machine) {
    mutate(
      () => fetch(`/api/machines/${m.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ is_active: !m.is_active }),
      }),
      m.is_active ? `${m.name} marked as not working` : `${m.name} back in service`
    );
  }

  if (!data) {
    // Skeleton shaped to the board (header + two machine cards), matching the
    // app-wide loading convention (see SkeletonRows/SkeletonText). Spinners are
    // prohibited in content areas per DESIGN.md.
    return (
      <div className="glass rounded-xl p-5" role="status" aria-label="Loading machines">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="h-7 w-28" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="glass rounded-xl border border-white/10 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-5 w-16" />
              </div>
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
        <span className="sr-only">Loading machines…</span>
      </div>
    );
  }

  const itemsByMachine = new Map<string, MachineQueueItem[]>();
  for (const item of data.queue) {
    const list = itemsByMachine.get(item.machine_id) ?? [];
    list.push(item);
    itemsByMachine.set(item.machine_id, list);
  }

  // A job runs on one machine at a time. Once it is queued or printing anywhere
  // it leaves every machine's picker — otherwise the same PO could be lined up
  // on two machines at once. data.queue excludes done items, so a job that has
  // finished becomes selectable again for a reprint.
  const queuedAnywhere = new Set(data.queue.map((i) => i.job_id));

  return (
    <div className="glass rounded-xl p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div>
          <h2 className="text-sm font-semibold text-[var(--glass-ink)]">Machines — Live Queues</h2>
          <p className="text-xs text-[var(--glass-muted)] mt-0.5">
            What&rsquo;s printing now and what&rsquo;s next on each machine.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-[var(--glass-muted)]">
            History:{' '}
            <input
              type="date"
              value={historyDate}
              onChange={(e) => setHistoryDate(e.target.value)}
              className="bg-white/[0.06] border border-white/10 min-h-11 rounded-lg px-2 py-1 text-xs text-[var(--glass-ink)] [color-scheme:dark]"
            />
          </label>
          {historyDate && (
            <button
              onClick={() => setHistoryDate('')}
              aria-label="Clear history date"
              className="p-1 rounded text-[var(--glass-muted)] hover:text-[var(--glass-ink)] hover:bg-white/10"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
          <Link
            href="/admin/machines"
            className="inline-flex min-h-11 items-center rounded-lg border border-white/10 px-2.5 text-xs text-[var(--glass-muted)] hover:bg-white/10 hover:text-[var(--glass-ink)]"
          >
            Utilisation report →
          </Link>
          {canManage && !showAddMachine && (
            <button
              onClick={() => setShowAddMachine(true)}
              className="text-xs px-2.5 py-1 rounded-lg bg-brand-primary text-white font-medium hover:bg-brand-primary/90 transition-colors"
            >
              + Add Machine
            </button>
          )}
        </div>
      </div>

      {showAddMachine && (
        <div className="flex items-end gap-2 flex-wrap mb-4 bg-white/[0.05] border border-white/10 rounded-lg p-3">
          <label className="text-xs text-[var(--glass-muted)]">
            Name
            <input
              value={machineName}
              onChange={(e) => setMachineName(e.target.value)}
              placeholder="Machine 3"
              className="block mt-1 bg-white/[0.06] border border-white/10 min-h-11 rounded-lg px-2 py-1.5 text-xs text-[var(--glass-ink)] w-40"
            />
          </label>
          <label className="text-xs text-[var(--glass-muted)]">
            Location (optional)
            <input
              value={machineLocation}
              onChange={(e) => setMachineLocation(e.target.value)}
              placeholder="Ground floor"
              className="block mt-1 bg-white/[0.06] border border-white/10 min-h-11 rounded-lg px-2 py-1.5 text-xs text-[var(--glass-ink)] w-40"
            />
          </label>
          <label className="text-xs text-[var(--glass-muted)]">
            Labels per hour (optional)
            <input
              value={machineRate}
              onChange={(e) => setMachineRate(e.target.value.replace(/[^0-9]/g, ''))}
              inputMode="numeric"
              placeholder="25000"
              title="Used to estimate finish times automatically"
              className="block mt-1 bg-white/[0.06] border border-white/10 min-h-11 rounded-lg px-2 py-1.5 text-xs text-[var(--glass-ink)] w-40 font-mono"
            />
          </label>
          <button
            onClick={addMachine}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded-lg bg-brand-primary text-white font-medium hover:bg-brand-primary/90 disabled:opacity-40"
          >
            Add
          </button>
          <button
            onClick={() => setShowAddMachine(false)}
            className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-[var(--glass-muted)] hover:bg-white/10"
          >
            Cancel
          </button>
        </div>
      )}

      {data.machines.length === 0 ? (
        <p className="text-sm text-[var(--glass-muted)] py-4 text-center">
          No machines yet{canManage ? ' — add the first one above.' : '.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {data.machines.map((m) => (
            <MachineCard
              key={m.id}
              machine={m}
              items={itemsByMachine.get(m.id) ?? []}
              availableJobs={data.available_jobs}
              queuedAnywhere={queuedAnywhere}
              canManage={canManage}
              busy={busy}
              onToggleFault={() => toggleFault(m)}
              onRemove={() => setConfirmRemove(m)}
              mutate={mutate}
            />
          ))}
        </div>
      )}

      {/* Printing history for the chosen date */}
      {historyDate && data.history && (
        <div className="mt-4 pt-4 border-t border-white/10">
          <p className="text-xs font-medium text-[var(--glass-muted)] uppercase tracking-wide mb-2">
            Printed on {format(new Date(`${historyDate}T00:00:00`), 'dd MMM yyyy')}
          </p>
          {data.history.length === 0 ? (
            <p className="text-xs text-[var(--glass-muted)]">Nothing was completed on this date.</p>
          ) : (
            <div className="space-y-1.5">
              {data.history.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center justify-between gap-3 bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-xs"
                >
                  <span className="min-w-0 truncate text-[var(--glass-ink)]">
                    <strong className="font-medium">{h.machines?.name ?? 'Machine'}</strong>
                    {' · '}
                    <span className="font-mono">{h.jobs?.po_number}</span>
                    {h.jobs?.job_name && <span className="text-[var(--glass-muted)]"> — {h.jobs.job_name}</span>}
                    {h.jobs?.label_qty != null && (
                      <span className="font-mono text-[var(--glass-muted)]"> · {formatQty(h.jobs.label_qty)}</span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-emerald-200">
                    {fmtDT(h.started_at)} → {fmtDT(h.completed_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {confirmRemove && (
        <ConfirmModal
          title={`Remove "${confirmRemove.name}"?`}
          message="This takes the machine off the board. Its printing history is kept."
          confirmLabel="Remove machine"
          tone="danger"
          busy={busy}
          onCancel={() => setConfirmRemove(null)}
          onConfirm={() => { const m = confirmRemove; setConfirmRemove(null); removeMachine(m); }}
        />
      )}
    </div>
  );
}

// ── One machine card ──────────────────────────────────────────

function MachineCard({
  machine,
  items,
  availableJobs,
  queuedAnywhere,
  canManage,
  busy,
  onToggleFault,
  onRemove,
  mutate,
}: {
  machine:       Machine;
  items:         MachineQueueItem[];
  availableJobs: AvailableJob[];
  /** job_ids queued or printing on ANY machine — excluded from this picker. */
  queuedAnywhere: Set<string>;
  canManage:     boolean;
  busy:          boolean;
  onToggleFault: () => void;
  onRemove:      () => void;
  mutate:        (fn: () => Promise<Response>, okMsg?: string) => Promise<boolean>;
}) {
  const [showAddJob, setShowAddJob] = useState(false);
  const [jobId, setJobId]           = useState('');
  const [estStart, setEstStart]     = useState('');
  const [estEnd, setEstEnd]         = useState('');
  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [editStart, setEditStart]   = useState('');
  const [editEnd, setEditEnd]       = useState('');
  const [confirmItem, setConfirmItem] = useState<MachineQueueItem | null>(null);

  const printing = items.find((i) => i.status === 'printing') ?? null;
  const queued   = items.filter((i) => i.status === 'queued');

  // Jobs not already queued or printing on any machine, this one included
  const selectableJobs = availableJobs.filter((j) => !queuedAnywhere.has(j.id));

  // Preview of the estimate the server will derive from this machine's run rate
  // when Est. finish is left blank.
  const pickedJob   = selectableJobs.find((j) => j.id === jobId) ?? null;
  const autoRunMs   = runDurationMs(pickedJob?.label_qty, machine.labels_per_hour);
  const autoFinish  = estimateFinishIso(
    estStart ? new Date(estStart).toISOString() : null,
    pickedJob?.label_qty,
    machine.labels_per_hour
  );
  const autoFinishLabel = autoFinish ? fmtDT(autoFinish) : null;

  async function addJob() {
    if (!jobId) { toast.error('Pick a job first'); return; }
    const ok = await mutate(
      () => fetch(`/api/machines/${machine.id}/queue`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          job_id:       jobId,
          est_start_at: toIsoOrNull(estStart),
          est_end_at:   toIsoOrNull(estEnd),
        }),
      }),
      'Job queued'
    );
    if (ok) { setJobId(''); setEstStart(''); setEstEnd(''); setShowAddJob(false); }
  }

  function itemPatch(item: MachineQueueItem, body: Record<string, unknown>, okMsg?: string) {
    return mutate(
      () => fetch(`/api/machines/${machine.id}/queue/${item.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      }),
      okMsg
    );
  }

  function removeItem(item: MachineQueueItem) {
    mutate(
      () => fetch(`/api/machines/${machine.id}/queue/${item.id}`, { method: 'DELETE' }),
      'Removed from queue'
    );
  }

  async function saveEdit(item: MachineQueueItem) {
    const ok = await itemPatch(item, {
      est_start_at: toIsoOrNull(editStart),
      est_end_at:   toIsoOrNull(editEnd),
    }, 'Estimates updated');
    if (ok) setEditItemId(null);
  }

  // ISO → value usable by <input type="datetime-local"> (local time)
  const toLocalInput = (iso: string | null) =>
    iso ? format(new Date(iso), "yyyy-MM-dd'T'HH:mm") : '';

  return (
    <div className={cn(
      'rounded-xl border p-4',
      machine.is_active ? 'glass border-white/10' : 'border-red-300/30 bg-red-400/[0.06]'
    )}>
      {/* Machine header */}
      <div className="flex items-center justify-between gap-2 mb-3 pb-3 border-b border-white/10">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--glass-ink)] truncate">
            {machine.name}
            {machine.location && (
              <span className="ml-2 text-xs font-normal text-[var(--glass-muted)]">{machine.location}</span>
            )}
          </p>
          <MachineRate machine={machine} canManage={canManage} busy={busy} mutate={mutate} />
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={cn(
            'text-[11px] font-medium px-2 py-0.5 rounded-full',
            machine.is_active ? 'bg-emerald-400/15 text-emerald-200' : 'bg-red-400/15 text-red-200'
          )}>
            {machine.is_active ? 'Working' : 'Not working'}
          </span>
          {/* Opens this machine's room display — the read-only screen projected
              in its production room. */}
          <Link
            href={`/display/${machine.id}`}
            target="_blank"
            rel="noopener"
            title={`Open ${machine.name} room display`}
            aria-label={`Open ${machine.name} room display in a new tab`}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-white/10 text-[var(--glass-muted)] hover:bg-white/10 hover:text-[var(--glass-ink)]"
          >
            <Monitor className="w-3.5 h-3.5" aria-hidden="true" />
          </Link>
          {canManage && (
            <>
              <button
                onClick={onToggleFault}
                disabled={busy}
                title={machine.is_active ? 'Mark as not working' : 'Mark as working'}
                className="text-[11px] px-2 py-0.5 rounded-lg border border-white/10 text-[var(--glass-muted)] hover:bg-white/10 disabled:opacity-40"
              >
                {machine.is_active ? 'Mark fault' : 'Mark working'}
              </button>
              <button
                onClick={onRemove}
                disabled={busy}
                title="Remove machine"
                aria-label={`Remove ${machine.name}`}
                className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-lg border border-white/10 text-[var(--glass-muted)] hover:bg-red-400/15 hover:text-red-200 disabled:opacity-40"
              >
                <X className="w-3 h-3" aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Now printing */}
      {printing ? (
        <div className="rounded-lg border border-sky-300/30 bg-sky-400/10 px-3 py-2.5 mb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-sky-200 mb-0.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-sky-300 animate-pulse mr-1.5 align-middle" />
                Now printing
              </p>
              <p className="text-sm font-medium text-[var(--glass-ink)] truncate">
                <span className="font-mono text-xs">{printing.jobs?.po_number}</span>
                {printing.jobs?.job_name && ` — ${printing.jobs.job_name}`}
              </p>
              <p className="text-[11px] font-mono text-[var(--glass-muted)] mt-0.5">
                {printing.jobs?.label_qty != null && `${formatQty(printing.jobs.label_qty)} labels · `}
                started {fmtDT(printing.started_at)}
                {printing.est_end_at && ` · est. finish ${fmtDT(printing.est_end_at)}`}
              </p>
            </div>
            {canManage && (
              <button
                onClick={() => itemPatch(printing, { action: 'complete' }, 'Marked completed')}
                disabled={busy}
                className="shrink-0 inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-emerald-400/15 border border-emerald-300/30 text-emerald-200 font-medium hover:bg-emerald-400/25 disabled:opacity-40"
              >
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
                Complete
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="text-xs text-[var(--glass-muted)] mb-3">
          {machine.is_active ? 'Idle — nothing printing right now.' : 'Marked as not working.'}
        </p>
      )}

      {/* Queue */}
      {queued.length > 0 && (
        <div className="space-y-1.5">
          {queued.map((item, idx) => (
            <div key={item.id} className="rounded-lg bg-white/[0.05] border border-white/10 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-white/10 text-[11px] font-mono text-[var(--glass-muted)] flex items-center justify-center">
                    {idx + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-[var(--glass-ink)] truncate">
                      <span className="font-mono">{item.jobs?.po_number}</span>
                      {item.jobs?.job_name && ` — ${item.jobs.job_name}`}
                    </p>
                    <p className="text-[11px] font-mono text-[var(--glass-muted)]">
                      {item.jobs?.label_qty != null && `${formatQty(item.jobs.label_qty)} · `}
                      est. {fmtDT(item.est_start_at)} → {fmtDT(item.est_end_at)}
                    </p>
                  </div>
                </div>

                {canManage && (
                  <div className="flex items-center gap-1 shrink-0">
                    {/* Primary action stays visible; the rest collapse into a
                        portalled overflow menu so the row stays touch-friendly. */}
                    <button
                      onClick={() => itemPatch(item, { action: 'start' }, 'Started — time noted')}
                      disabled={busy || !!printing || !machine.is_active}
                      title={printing ? 'Another job is printing' : 'Start printing (stamps the time)'}
                      className="inline-flex items-center gap-1 text-[11px] px-2 h-6 rounded bg-sky-400/15 border border-sky-300/30 text-sky-200 font-medium hover:bg-sky-400/25 disabled:opacity-30"
                    ><Play className="w-3 h-3" aria-hidden="true" /> Start</button>
                    <OverflowMenu
                      label={`More actions for ${item.jobs?.po_number ?? 'this job'}`}
                      disabled={busy}
                      actions={[
                        {
                          label: 'Move up',
                          icon: <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />,
                          onClick: () => itemPatch(item, { action: 'move_up' }),
                          disabled: busy || idx === 0,
                        },
                        {
                          label: 'Move down',
                          icon: <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />,
                          onClick: () => itemPatch(item, { action: 'move_down' }),
                          disabled: busy || idx === queued.length - 1,
                        },
                        {
                          label: 'Edit estimated times',
                          icon: <Pencil className="w-3 h-3" aria-hidden="true" />,
                          onClick: () => {
                            setEditItemId(editItemId === item.id ? null : item.id);
                            setEditStart(toLocalInput(item.est_start_at));
                            setEditEnd(toLocalInput(item.est_end_at));
                          },
                        },
                        {
                          label: 'Remove from queue',
                          icon: <X className="w-3.5 h-3.5" aria-hidden="true" />,
                          onClick: () => setConfirmItem(item),
                          danger: true,
                          disabled: busy,
                        },
                      ]}
                    />
                  </div>
                )}
              </div>

              {editItemId === item.id && (
                <div className="flex items-end gap-2 flex-wrap mt-2 pt-2 border-t border-white/10">
                  <label className="text-[11px] text-[var(--glass-muted)]">
                    Est. start
                    <input
                      type="datetime-local"
                      value={editStart}
                      onChange={(e) => setEditStart(e.target.value)}
                      className="block mt-0.5 bg-white/[0.06] border border-white/10 min-h-11 rounded px-1.5 py-1 text-[11px] text-[var(--glass-ink)] [color-scheme:dark]"
                    />
                  </label>
                  <label className="text-[11px] text-[var(--glass-muted)]">
                    Est. finish
                    <input
                      type="datetime-local"
                      value={editEnd}
                      onChange={(e) => setEditEnd(e.target.value)}
                      className="block mt-0.5 bg-white/[0.06] border border-white/10 min-h-11 rounded px-1.5 py-1 text-[11px] text-[var(--glass-ink)] [color-scheme:dark]"
                    />
                  </label>
                  <button
                    onClick={() => saveEdit(item)}
                    disabled={busy}
                    className="text-[11px] px-2.5 py-1 rounded bg-brand-primary text-white font-medium hover:bg-brand-primary/90 disabled:opacity-40"
                  >Save</button>
                  <button
                    onClick={() => setEditItemId(null)}
                    className="text-[11px] px-2 py-1 rounded border border-white/10 text-[var(--glass-muted)] hover:bg-white/10"
                  >Cancel</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {queued.length === 0 && !printing && (
        <p className="text-[11px] text-[var(--glass-muted)] mb-1">Queue is empty.</p>
      )}

      {/* Add job to queue */}
      {canManage && (
        showAddJob ? (
          <div className="flex items-end gap-2 flex-wrap mt-3 pt-3 border-t border-white/10">
            <label className="text-[11px] text-[var(--glass-muted)] min-w-0 flex-1">
              Job
              <select
                value={jobId}
                onChange={(e) => setJobId(e.target.value)}
                className="block mt-0.5 w-full bg-white/[0.06] border border-white/10 min-h-11 rounded px-1.5 py-1.5 text-[11px] text-[var(--glass-ink)] [&>option]:bg-[#0A1F18]"
              >
                <option value="">Select a job…</option>
                {selectableJobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.po_number} — {j.job_name ?? j.party}
                    {j.label_qty != null ? ` (${formatQty(j.label_qty)})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px] text-[var(--glass-muted)]">
              Est. start
              <input
                type="datetime-local"
                value={estStart}
                onChange={(e) => setEstStart(e.target.value)}
                className="block mt-0.5 bg-white/[0.06] border border-white/10 min-h-11 rounded px-1.5 py-1 text-[11px] text-[var(--glass-ink)] [color-scheme:dark]"
              />
            </label>
            <label className="text-[11px] text-[var(--glass-muted)]">
              Est. finish
              <input
                type="datetime-local"
                value={estEnd}
                onChange={(e) => setEstEnd(e.target.value)}
                className="block mt-0.5 bg-white/[0.06] border border-white/10 min-h-11 rounded px-1.5 py-1 text-[11px] text-[var(--glass-ink)] [color-scheme:dark]"
              />
            </label>
            <button
              onClick={addJob}
              disabled={busy}
              className="text-[11px] px-2.5 py-1.5 rounded bg-brand-primary text-white font-medium hover:bg-brand-primary/90 disabled:opacity-40"
            >Add</button>
            <button
              onClick={() => setShowAddJob(false)}
              className="text-[11px] px-2 py-1.5 rounded border border-white/10 text-[var(--glass-muted)] hover:bg-white/10"
            >Cancel</button>

            {/* What the machine's run rate will fill in if Est. finish is left
                blank. Only a preview — the server does the same sum on save. */}
            {autoRunMs !== null && !estEnd && (
              <p className="w-full text-[11px] text-[var(--glass-muted)]">
                <Gauge className="mr-1 inline h-3 w-3 align-[-2px]" aria-hidden="true" />
                Auto finish: <span className="font-mono">{formatDuration(autoRunMs)}</span> at{' '}
                <span className="font-mono">{formatQty(machine.labels_per_hour)}</span>/hr
                {autoFinishLabel && <> · ends <span className="font-mono">{autoFinishLabel}</span></>}
              </p>
            )}
          </div>
        ) : (
          <button
            onClick={() => setShowAddJob(true)}
            className="mt-3 text-[11px] px-2.5 py-1 rounded-lg border border-dashed border-white/20 text-[var(--glass-muted)] hover:text-[var(--glass-ink)] hover:border-white/35 transition-colors"
          >
            + Add job to queue
          </button>
        )
      )}

      {confirmItem && (
        <ConfirmModal
          title="Remove from queue?"
          message={`Remove ${confirmItem.jobs?.po_number ?? 'this job'} from ${machine.name}'s queue?`}
          confirmLabel="Remove"
          tone="danger"
          busy={busy}
          onCancel={() => setConfirmItem(null)}
          onConfirm={() => { const it = confirmItem; setConfirmItem(null); removeItem(it); }}
        />
      )}
    </div>
  );
}

// ── Machine run rate ──────────────────────────────────────────
// Labels/hour, which drives the automatic finish estimates. Shown to everyone,
// editable in place by Production/Admin — there is no other machine-edit screen,
// and sending people elsewhere to type one number would be worse.

function MachineRate({
  machine,
  canManage,
  busy,
  mutate,
}: {
  machine:   Machine;
  canManage: boolean;
  busy:      boolean;
  mutate:    (fn: () => Promise<Response>, okMsg?: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue]     = useState('');

  async function save() {
    const ok = await mutate(
      () => fetch(`/api/machines/${machine.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ labels_per_hour: value === '' ? null : value }),
      }),
      value === '' ? 'Run rate cleared' : 'Run rate saved'
    );
    if (ok) setEditing(false);
  }

  if (editing) {
    return (
      <span className="mt-1 flex items-center gap-1.5">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ''))}
          inputMode="numeric"
          autoFocus
          aria-label={`Labels per hour for ${machine.name}`}
          placeholder="25000"
          className="w-24 rounded border border-white/10 bg-white/[0.06] px-1.5 py-1 font-mono text-[11px] text-[var(--glass-ink)]"
        />
        <span className="text-[11px] text-[var(--glass-muted)]">/hr</span>
        <button
          onClick={save}
          disabled={busy}
          className="rounded bg-brand-primary px-2 py-0.5 text-[11px] font-medium text-white hover:bg-brand-primary/90 disabled:opacity-40"
        >Save</button>
        <button
          onClick={() => setEditing(false)}
          className="rounded border border-white/10 px-2 py-0.5 text-[11px] text-[var(--glass-muted)] hover:bg-white/10"
        >Cancel</button>
      </span>
    );
  }

  const start = () => { setValue(machine.labels_per_hour ? String(machine.labels_per_hour) : ''); setEditing(true); };

  if (machine.labels_per_hour) {
    return (
      <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--glass-muted)]">
        <Gauge className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="font-mono">{formatQty(machine.labels_per_hour)}</span> labels/hr
        {canManage && (
          <button
            onClick={start}
            aria-label={`Change run rate for ${machine.name}`}
            title="Change run rate"
            className="rounded p-0.5 text-[var(--glass-muted)] hover:bg-white/10 hover:text-[var(--glass-ink)]"
          ><Pencil className="h-2.5 w-2.5" aria-hidden="true" /></button>
        )}
      </span>
    );
  }

  if (!canManage) return null;
  return (
    <button
      onClick={start}
      title="Set labels per hour to get automatic finish estimates"
      className="mt-0.5 flex items-center gap-1 text-[11px] text-[var(--glass-muted)] underline decoration-dotted underline-offset-2 hover:text-[var(--glass-ink)]"
    >
      <Gauge className="h-3 w-3" aria-hidden="true" />
      Set run rate
    </button>
  );
}

// ── Overflow menu ─────────────────────────────────────────────
// A "⋯" trigger plus a portalled, fixed-position menu that escapes the
// card's stacking/clipping context. Keyboard: Escape closes and returns
// focus to the trigger; Arrow keys cycle items. Closes on outside click,
// scroll, or resize. Rendered instantly (no entrance motion), so it needs
// no separate reduced-motion path. The dark surface (#0A1F18) keeps it off
// the glass-on-glass ladder per DESIGN.md.

type MenuAction = {
  label:     string;
  icon:      React.ReactNode;
  onClick:   () => void;
  danger?:   boolean;
  disabled?: boolean;
};

function OverflowMenu({
  label,
  actions,
  disabled,
}: {
  label:     string;
  actions:   MenuAction[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos]   = useState<{ top: number; left: number } | null>(null);
  const btnRef  = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent) {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); }
    }
    function close() { setOpen(false); }
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    // Focus the first enabled item once the menu is on screen
    menuRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  function toggle() {
    if (open) { setOpen(false); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ top: r.bottom + 6, left: r.right });
    setOpen(true);
  }

  function onMenuKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [],
    );
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown'
      ? (i + 1) % items.length
      : (i - 1 + items.length) % items.length;
    items[next]?.focus();
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title="More actions"
        className="inline-flex items-center justify-center w-6 h-6 rounded border border-white/10 text-[var(--glass-muted)] hover:bg-white/10 disabled:opacity-30"
      ><MoreHorizontal className="w-3.5 h-3.5" aria-hidden="true" /></button>

      {open && pos && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          style={{ position: 'fixed', top: pos.top, left: pos.left, transform: 'translateX(-100%)' }}
          className="z-40 min-w-[176px] rounded-lg border border-white/10 bg-white p-1 shadow-[0_8px_30px_rgba(0,0,0,0.18)]"
        >
          {actions.map((a) => (
            <button
              key={a.label}
              role="menuitem"
              disabled={a.disabled}
              onClick={() => { setOpen(false); a.onClick(); }}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs text-left transition-colors disabled:opacity-30',
                a.danger
                  ? 'text-red-200 hover:bg-red-400/15'
                  : 'text-[var(--glass-ink)] hover:bg-white/10',
              )}
            >
              <span className="shrink-0">{a.icon}</span>
              {a.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
