// src/lib/machineQueue.ts
// ============================================================
// The arithmetic behind the Machines page: what state a machine is in, how
// far through its run, and the order a queue lands in after a drag.
// Pure, so the page, the reorder API and the tests agree on every number.
// ============================================================

import { runDurationMs } from '@/lib/machineSpeed';
import type { Machine, MachineQueueItem } from '@/lib/types';

/** `ids` with the item at `from` moved to `to`. Out-of-range moves return a copy unchanged. */
export function moveItem<T>(ids: readonly T[], from: number, to: number): T[] {
  const next = ids.slice();
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  const [picked] = next.splice(from, 1);
  next.splice(to, 0, picked);
  return next;
}

/**
 * True when `order` is exactly the ids in `current`, each once — the check the
 * reorder API makes so a stale screen can't drop or invent queue items.
 */
export function sameMembers(order: readonly string[], current: readonly string[]): boolean {
  if (order.length !== current.length) return false;
  const want = new Set(current);
  const seen = new Set<string>();
  for (const id of order) {
    if (!want.has(id) || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

export type MachineState = 'running' | 'idle' | 'down';

export type MachineSnapshot = {
  state:    MachineState;
  printing: MachineQueueItem | null;
  queued:   MachineQueueItem[];
  /** 0–99 while a run with a known rate is going; null when it can't be known. */
  pct:      number | null;
  /** Labels done so far, estimated from the rate. Null alongside pct. */
  doneQty:  number | null;
  /** Projected finish (ms since epoch), from the rate or Production's estimate. */
  etaMs:    number | null;
};

/** One machine's live picture from the board query. `now` is ms since epoch. */
export function machineSnapshot(machine: Machine, queue: readonly MachineQueueItem[], now: number): MachineSnapshot {
  const mine     = queue.filter((q) => q.machine_id === machine.id).sort((a, b) => a.position - b.position);
  const printing = mine.find((q) => q.status === 'printing') ?? null;
  const queued   = mine.filter((q) => q.status === 'queued');

  let pct: number | null = null;
  let doneQty: number | null = null;
  let etaMs: number | null = null;

  if (printing?.started_at) {
    const start = Date.parse(printing.started_at);
    const qty   = printing.jobs?.label_qty ?? null;
    const dur   = runDurationMs(qty, machine.labels_per_hour);
    if (dur && qty && Number.isFinite(start)) {
      // Never claim 100% — only Complete says the run is finished.
      pct     = Math.min(99, Math.max(0, Math.round(((now - start) / dur) * 100)));
      doneQty = Math.min(qty, Math.max(0, Math.round((qty * pct) / 100)));
      etaMs   = start + dur;
    } else if (printing.est_end_at) {
      const est = Date.parse(printing.est_end_at);
      etaMs = Number.isFinite(est) ? est : null;
    }
  }

  const state: MachineState = !machine.is_active ? 'down' : printing ? 'running' : 'idle';
  return { state, printing, queued, pct, doneQty, etaMs };
}

/**
 * Cumulative run time for each queued item, in queue order, starting after
 * whatever is printing now. Null for an item once any earlier length is unknown —
 * a guess stacked on a gap isn't worth showing.
 */
export function queueOffsetsMs(
  queued:        readonly MachineQueueItem[],
  labelsPerHour: number | null | undefined,
  remainingNowMs = 0,
): (number | null)[] {
  let acc: number | null = remainingNowMs;
  return queued.map((q) => {
    const dur = runDurationMs(q.jobs?.label_qty, labelsPerHour);
    acc = acc === null || dur === null ? null : acc + dur;
    return acc;
  });
}
