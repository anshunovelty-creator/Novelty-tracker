import { describe, it, expect } from 'vitest';
import { mergeRows, fingerprintOf, printMismatch, syncReports, type Fetched } from './reportSync';
import type { SepRow } from './reports';

const row = (id: string, p: Partial<SepRow> = {}): SepRow => ({
  id, sr_no: null, day: '2026-10-05', party: 'Arysta', po_no: 'PO1', pm_code: 'PM1', material_name: 'Label',
  quantity: 1000, unit: '1', rate: 2, order_value: 2000, jc_status: null, aw_send_to: null, cancelled: false, ...p,
});

describe('mergeRows', () => {
  const prev = [row('a'), row('c')];
  it('keeps the same array when the changes are re-sends of what it has', () => {
    const m = mergeRows(prev, [row('a')]);
    expect(m.rows).toBe(prev);
    expect(m.changed).toBe(0);
  });
  it('replaces edited rows and adds new ones in id order', () => {
    const m = mergeRows(prev, [row('c', { order_value: 5 }), row('b')]);
    expect(m.changed).toBe(2);
    expect(m.rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(m.rows[2].order_value).toBe(5);
    expect(prev[1].order_value).toBe(2000);   // the old copy isn't touched
  });
});

describe('fingerprint', () => {
  const rows = [row('a'), row('b', { day: '2026-09-30', quantity: 10, order_value: 20.25 }), row('c', { cancelled: true, order_value: 999 })];
  const db = [
    { month: '2026-09', lines: 1, cancelled: 0, value: 20.25, qty: 10 },
    { month: '2026-10', lines: 1, cancelled: 1, value: 2000, qty: 1000 },
  ];
  it('adds up live rows per month and counts cancelled ones apart', () => {
    expect(fingerprintOf(rows)).toEqual(db);
    expect(printMismatch(db, fingerprintOf(rows))).toBeNull();
  });
  it('names the first month that disagrees, including one the page lacks', () => {
    expect(printMismatch(db, fingerprintOf(rows.slice(0, 1)))).toMatch(/^2026-09: database 1 lines/);
    expect(printMismatch([...db, { month: '2026-11', lines: 1, cancelled: 0, value: 1, qty: 1 }], fingerprintOf(rows))).toMatch(/^2026-11/);
  });
  it('allows half a rupee of floating-point drift a month', () => {
    expect(printMismatch([{ ...db[0], value: 20.3 }, db[1]], fingerprintOf(rows))).toBeNull();
    expect(printMismatch([{ ...db[0], value: 21 }, db[1]], fingerprintOf(rows))).not.toBeNull();
  });
});

describe('syncReports', () => {
  // A fake database: its rows, and what GET /api/reports would answer.
  const table = new Map([['a', row('a')], ['b', row('b')]]);
  const calls: (string | null)[] = [];
  const get = async (since: string | null): Promise<Fetched> => {
    calls.push(since);
    const all = Array.from(table.values());
    return { full: !since, rows: since ? all.filter((r) => r.sr_no === 'new') : all, cursor: 't2', print: fingerprintOf(all), cards: [], today: '2026-10-15' };
  };

  it('loads everything first, then only changes; nothing changed keeps the rows as they were', async () => {
    const first = await syncReports(undefined, false, get);
    expect(first.sync).toMatchObject({ full: true, mismatch: null });
    const again = await syncReports(first, false, get);
    expect(again.sync).toMatchObject({ full: false, changed: 0 });
    expect(again.rows).toBe(first.rows);
    expect(calls).toEqual([null, 't2']);
  });
  it('folds in a new row from the delta', async () => {
    const first = await syncReports(undefined, false, get);
    table.set('c', row('c', { sr_no: 'new' }));
    const next = await syncReports(first, false, get);
    expect(next.sync).toMatchObject({ full: false, changed: 1, mismatch: null });
    expect(next.rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
  it('reloads everything when the copy no longer adds up to the database', async () => {
    const first = await syncReports(undefined, false, get);
    table.delete('a');                       // a change the delta can't show
    calls.length = 0;
    const next = await syncReports(first, false, get);
    expect(calls).toEqual(['t2', null]);
    expect(next.sync).toMatchObject({ full: true, mismatch: null });
    expect(next.rows.map((r) => r.id)).toEqual(['b', 'c']);
  });
});
