import { describe, it, expect } from 'vitest';
import { stockForTab, sixMonthsBefore, stockTotals } from './stockViews';
import type { LabelStock } from '@/lib/types';

function entry(p: Partial<LabelStock>): LabelStock {
  return {
    id: p.id ?? 'x', kind: 'Extra', qty: 100, is_dispatched: false,
    created_at: '2026-09-01T05:00:00Z', party: 'P', ...p,
  } as LabelStock;
}

describe('sixMonthsBefore', () => {
  it('rolls back across the year', () => {
    expect(sixMonthsBefore('2026-03-15')).toBe('2025-09-15');
  });
  it('clamps to the last day of a shorter month', () => {
    expect(sixMonthsBefore('2026-08-31')).toBe('2026-02-28');
  });
});

describe('stockForTab', () => {
  const rows = [
    entry({ id: 'r', kind: 'Remaining' }),
    entry({ id: 'e', kind: 'Extra' }),
    entry({ id: 'm', kind: 'Manual' }),
    entry({ id: 'd', kind: 'Extra', is_dispatched: true }),
  ];
  it('shelf is every live entry', () => {
    expect(stockForTab(rows, 'shelf').map((s) => s.id)).toEqual(['r', 'e', 'm']);
  });
  it('a kind tab never shows dispatched rows', () => {
    expect(stockForTab(rows, 'Extra').map((s) => s.id)).toEqual(['e']);
  });
  it('history is only dispatched rows', () => {
    expect(stockForTab(rows, 'history').map((s) => s.id)).toEqual(['d']);
  });
});

describe('stockTotals', () => {
  const now = new Date('2026-10-05T06:00:00Z');
  it('splits usable from promised and skips dispatched stock', () => {
    const t = stockTotals([
      entry({ kind: 'Extra', qty: 200 }),
      entry({ kind: 'Manual', qty: 50 }),
      entry({ kind: 'Remaining', qty: 1000 }),
      entry({ kind: 'Extra', qty: 9999, is_dispatched: true }),
    ], now);
    expect([t.usableQty, t.usableCount, t.promisedQty, t.promisedCount]).toEqual([250, 2, 1000, 1]);
  });
  it('counts stock added before the six-month cutoff as not moved', () => {
    const t = stockTotals([
      entry({ qty: 10, created_at: '2026-04-04T05:00:00Z' }), // 04 Apr — stale
      entry({ qty: 20, created_at: '2026-04-05T05:00:00Z' }), // exactly six months — not yet
    ], now);
    expect([t.staleQty, t.staleCount]).toEqual([10, 1]);
  });
});
