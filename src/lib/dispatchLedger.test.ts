import { describe, it, expect } from 'vitest';
import { lineFor, entryWarnings, dispatchOf, dispatchedByLine, type DispatchEntry } from './dispatchLedger';
import type { SepRow } from './reports';

const row = (p: Partial<SepRow>): SepRow => ({
  id: Math.random().toString(36), sr_no: null, day: '2026-10-05', party: 'Arysta', po_no: 'PO1',
  pm_code: 'PM1', material_name: 'Front label', quantity: 1000, unit: '1', rate: 2, order_value: 2000,
  jc_status: 'DONE', aw_send_to: 'REPEAT', cancelled: false, ...p,
});
const entry = (p: Partial<DispatchEntry>): DispatchEntry => ({
  id: Math.random().toString(36), party: 'Arysta', po: 'PO1', pm: 'PM1', qty: 400, day: '2026-10-10', ...p,
});

describe('lineFor', () => {
  const a = row({ id: 'a', po_no: ' po1 ', pm_code: 'pm1' });
  const b = row({ id: 'b', po_no: 'PO1', pm_code: 'PM2' });
  it('matches PO and PM code, ignoring case and spaces', () => {
    expect(lineFor('PO1', 'PM1', [a, b])?.id).toBe('a');
  });
  it('matches on PO alone only when the PO has one line', () => {
    expect(lineFor('PO1', null, [a, b])).toBeNull();
    expect(lineFor('PO1', '', [a])?.id).toBe('a');
  });
  it('refuses to guess between two lines with the same PO and PM code', () => {
    expect(lineFor('PO1', 'PM1', [a, row({ po_no: 'PO1', pm_code: 'PM1' })])).toBeNull();
  });
});

describe('dispatchedByLine', () => {
  it('adds entries up per line and skips ones that match no single line', () => {
    const lines = [row({ id: 'a', po_no: 'PO1', pm_code: 'PM1' }), row({ id: 'b', po_no: 'PO1', pm_code: 'PM2' })];
    const m = dispatchedByLine(lines, [
      { po_number: 'po1', pm_code: 'PM1', qty: 300 },
      { po_number: 'PO1', pm_code: 'PM1', qty: 200 },
      { po_number: 'PO1', pm_code: null, qty: 999 },   // two lines on PO1: no guess
    ]);
    expect(m.get('a')).toBe(500);
    expect(m.has('b')).toBe(false);
  });
});

describe('entryWarnings', () => {
  const now = new Date('2026-10-21T10:00:00+05:30');
  it('says nothing for a first entry inside the order', () => {
    expect(entryWarnings({ line: { quantity: 1000 }, others: [], qty: 400, now })).toEqual([]);
  });
  it('flags the same PO + PM code entered in the last three days', () => {
    const w = entryWarnings({ line: { quantity: 10000 }, others: [{ qty: 3000, created_at: '2026-10-19T12:00:00+05:30' }], qty: 3000, now });
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('19 Oct');
    expect(entryWarnings({ line: { quantity: 10000 }, others: [{ qty: 3000, created_at: '2026-10-10T12:00:00+05:30' }], qty: 3000, now })).toEqual([]);
  });
  it('flags going over the order, counting what is already entered', () => {
    const w = entryWarnings({ line: { quantity: 10000 }, others: [{ qty: 7000, created_at: '2026-10-01T00:00:00Z' }], qty: 4000, now });
    expect(w[0]).toContain('1,000 more than ordered');
  });
  it('flags an entry with no order line', () => {
    expect(entryWarnings({ line: null, others: [], qty: 10, now })[0]).toContain('No order line');
  });
});

describe('dispatchOf', () => {
  const period = { from: '2026-10-01', to: '2026-10-21' };
  const previous = { from: '2026-09-01', to: '2026-09-21' };
  const none = { unit: null, group: null, party: null };

  it('is null before tracking starts, and counts every line pending from then with no entries yet', () => {
    expect(dispatchOf([row({})], [], period, previous, none, '2026-10-20', '2026-10-21')).toBeNull();
    const v = dispatchOf([row({ day: '2026-10-21' })], [], period, previous, none, '2026-10-21', '2026-10-21')!;
    expect(v.open.lines).toBe(1);
    expect(v.shipped.entries).toBe(0);
  });

  it('ignores orders and entries dated before tracking starts', () => {
    const v = dispatchOf([row({ day: '2026-10-05' })], [entry({ day: '2026-10-10' })], period, previous, none, '2026-10-21', '2026-10-15')!;
    expect(v.shipped.entries).toBe(0);
    expect(v.open.lines).toBe(0);
    expect(v.untracked.lines).toBe(1);
  });

  it('adds part dispatches up to pending and full', () => {
    const lines = [
      row({ id: 'part', po_no: 'PO1', quantity: 1000, rate: 2 }),
      row({ id: 'full', po_no: 'PO2', quantity: 500, rate: 3, order_value: 1500 }),
      row({ id: 'none', po_no: 'PO3', quantity: 200, rate: 1, order_value: 200, day: '2026-09-01' }),
    ];
    const v = dispatchOf(lines, [
      entry({ po: 'PO1', qty: 300, day: '2026-09-02' }),
      entry({ po: 'PO1', qty: 300, day: '2026-10-12' }),
      entry({ po: 'PO2', qty: 500, day: '2026-10-08' }),
      entry({ po: 'TEST', pm: null, qty: 99, day: '2026-10-09' }),
    ], period, previous, none, '2026-10-21', '2026-09-02')!;

    expect(v.since).toBe('2026-09-02');
    expect(v.shipped).toEqual({ qty: 800, value: 300 * 2 + 500 * 3, entries: 2 });
    expect(v.prevShipped.qty).toBe(300);
    expect(v.unmatched).toEqual({ qty: 99, value: 0, entries: 1 });
    // PO3 is dated before the first dispatch record: not tracked, not pending.
    expect(v.untracked).toEqual({ lines: 0, value: 0 });
    expect(v.open.lines).toBe(1);
    expect(v.open.qty).toBe(400);
    expect(v.open.value).toBe(800);
    expect(v.ordered).toMatchObject({ lines: 2, full: 1, part: 1, none: 0, pendingQty: 400 });
    expect(v.leadDone).toBe(3);   // PO2: ordered 5 Oct, complete 8 Oct
  });

  it('lists over-dispatch and keeps held lines out of the open book', () => {
    const lines = [
      row({ id: 'big', po_no: 'PO1', quantity: 1000 }),
      row({ id: 'held', po_no: 'PO2', quantity: 1000, jc_status: 'PO HOLD' }),
    ];
    const v = dispatchOf(lines, [entry({ po: 'PO1', qty: 1100, day: '2026-10-06' }), entry({ po: 'PO2', qty: 1, day: '2026-10-01' })],
      period, previous, none, '2026-10-21', '2026-10-01')!;
    expect(v.over.map((s) => [s.line.id, s.over])).toEqual([['big', 100]]);
    expect(v.open.lines).toBe(0);
    expect(v.held.lines).toBe(1);
  });
});
