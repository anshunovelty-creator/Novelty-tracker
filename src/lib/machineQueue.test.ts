import { describe, it, expect } from 'vitest';
import { moveItem, sameMembers, machineSnapshot, queueOffsetsMs } from './machineQueue';
import type { Machine, MachineQueueItem } from './types';

const machine = (over: Partial<Machine> = {}): Machine => ({
  id: 'm1', name: 'Flexo Press 1', location: null, is_active: true, is_retired: false,
  created_at: '2026-01-01T00:00:00Z', labels_per_hour: 6000, ...over,
});

const item = (over: Partial<MachineQueueItem>): MachineQueueItem => ({
  id: 'i', machine_id: 'm1', job_id: 'j', position: 1, est_start_at: null, est_end_at: null,
  started_at: null, completed_at: null, status: 'queued', created_by: null, created_at: '',
  jobs: { po_number: 'PO', job_name: null, party: 'P', label_qty: 6000 }, ...over,
});

describe('moveItem', () => {
  it('moves down and up', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });
  it('ignores out-of-range and no-op moves', () => {
    expect(moveItem(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], -1, 0)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });
});

describe('sameMembers', () => {
  it('accepts a permutation', () => expect(sameMembers(['b', 'a'], ['a', 'b'])).toBe(true));
  it('rejects missing, extra and duplicate ids', () => {
    expect(sameMembers(['a'], ['a', 'b'])).toBe(false);
    expect(sameMembers(['a', 'b', 'c'], ['a', 'b'])).toBe(false);
    expect(sameMembers(['a', 'a'], ['a', 'b'])).toBe(false);
    expect(sameMembers(['a', 'x'], ['a', 'b'])).toBe(false);
  });
});

describe('machineSnapshot', () => {
  const start = Date.parse('2026-10-05T10:00:00Z');

  it('reports progress, labels done and ETA from the run rate', () => {
    const q = [item({ id: 'p', status: 'printing', started_at: '2026-10-05T10:00:00Z', jobs: { po_number: 'A', job_name: null, party: 'X', label_qty: 12000 } })];
    const s = machineSnapshot(machine(), q, start + 30 * 60_000); // 30 min of a 2 h run
    expect(s.state).toBe('running');
    expect(s.pct).toBe(25);
    expect(s.doneQty).toBe(3000);
    expect(s.etaMs).toBe(start + 2 * 3_600_000);
  });

  it('caps at 99% when the run overruns', () => {
    const q = [item({ id: 'p', status: 'printing', started_at: '2026-10-05T10:00:00Z' })];
    expect(machineSnapshot(machine(), q, start + 5 * 3_600_000).pct).toBe(99);
  });

  it('falls back to the stored estimate when there is no rate', () => {
    const q = [item({ id: 'p', status: 'printing', started_at: '2026-10-05T10:00:00Z', est_end_at: '2026-10-05T12:30:00Z' })];
    const s = machineSnapshot(machine({ labels_per_hour: null }), q, start);
    expect(s.pct).toBeNull();
    expect(s.etaMs).toBe(Date.parse('2026-10-05T12:30:00Z'));
  });

  it('separates the queue in position order and ignores other machines', () => {
    const q = [
      item({ id: 'b', position: 3 }),
      item({ id: 'a', position: 2 }),
      item({ id: 'z', machine_id: 'm2', position: 1 }),
    ];
    const s = machineSnapshot(machine(), q, start);
    expect(s.state).toBe('idle');
    expect(s.queued.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('marks a machine taken out of service as down', () => {
    expect(machineSnapshot(machine({ is_active: false }), [], start).state).toBe('down');
  });
});

describe('queueOffsetsMs', () => {
  it('stacks run lengths after the current run', () => {
    const q = [item({ id: 'a' }), item({ id: 'b', jobs: { po_number: 'B', job_name: null, party: 'X', label_qty: 3000 } })];
    expect(queueOffsetsMs(q, 6000, 600_000)).toEqual([600_000 + 3_600_000, 600_000 + 3_600_000 + 1_800_000]);
  });
  it('goes unknown after the first gap', () => {
    const q = [item({ id: 'a', jobs: { po_number: 'A', job_name: null, party: 'X', label_qty: null } }), item({ id: 'b' })];
    expect(queueOffsetsMs(q, 6000)).toEqual([null, null]);
  });
});
