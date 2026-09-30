// src/lib/bom.test.ts
// Bill of Material pricing: expense, difference, margin and the sheet's
// totals line. Expense is metres × width (mm → m) × ₹ per m².

import { describe, expect, it } from 'vitest';
import {
  materialExpense, orderDifference, marginPercent, costingTotals, parseInputNumber, formatInr,
} from './bom';

describe('materialExpense', () => {
  it('1,000 m of 250 mm stock at ₹40/m² → ₹10,000', () => {
    expect(materialExpense(1000, 250, 40)).toBe(10000);
  });

  it('rounds to paise', () => {
    // 1,234.5 × 0.11 × 37.35 = 5,071.94325
    expect(materialExpense(1234.5, 110, 37.35)).toBe(5071.94);
    // 2,794 m (the Meter tab's answer) × 0.1 m × ₹32.5
    expect(materialExpense(2794, 100, 32.5)).toBe(9080.5);
  });

  it('half-paisa values are at the mercy of float representation', () => {
    // Current behaviour: 1 × 1 × 1.005 is 1.00499999… in binary, so it
    // rounds to ₹1.00, not ₹1.01. Sub-paisa, never visible on a real job.
    expect(materialExpense(1, 1000, 1.005)).toBe(1);
    expect(materialExpense(1, 1000, 1.015)).toBe(1.01);
    expect(materialExpense(1, 1000, 1.0051)).toBe(1.01);   // clearly over half a paisa
  });

  it.each([
    ['no metres',        null,      250, 40],
    ['undefined metres', undefined, 250, 40],
    ['zero metres',      0,         250, 40],
    ['negative metres',  -100,      250, 40],
    ['no width',         1000,      null, 40],
    ['zero width',       1000,      0,    40],
    ['negative width',   1000,      -250, 40],
    ['no rate',          1000,      250,  null],
    ['zero rate',        1000,      250,  0],
    ['negative rate',    1000,      250,  -40],
    ['NaN metres',       NaN,       250,  40],
  ])('null — never ₹0 — with %s', (_, m, w, r) => {
    expect(materialExpense(m, w, r)).toBeNull();
  });
});

describe('orderDifference', () => {
  it('order value minus expense', () => {
    expect(orderDifference(12000, 10000)).toBe(2000);
  });

  it('goes negative when the job loses money', () => {
    expect(orderDifference(9000, 10000)).toBe(-1000);
  });

  it('rounds to paise, trimming float noise', () => {
    expect(orderDifference(0.3, 0.1)).toBe(0.2);          // 0.19999999999999998 raw
    expect(orderDifference(12500.75, 5071.94)).toBe(7428.81);
  });

  it('a zero order value is a real value (difference = −expense)', () => {
    expect(orderDifference(0, 500)).toBe(-500);
  });

  it('a zero expense is a real value too', () => {
    expect(orderDifference(12000, 0)).toBe(12000);
  });

  it('null until both sides are known', () => {
    expect(orderDifference(null, 10000)).toBeNull();
    expect(orderDifference(undefined, 10000)).toBeNull();
    expect(orderDifference(12000, null)).toBeNull();
    expect(orderDifference(12000, undefined)).toBeNull();
  });
});

describe('marginPercent', () => {
  it('difference over order value, one decimal', () => {
    expect(marginPercent(2000, 12000)).toBe('16.7');
    expect(marginPercent(-1000, 12000)).toBe('-8.3');
    expect(marginPercent(0, 12000)).toBe('0.0');
  });

  it('null when the difference is unknown', () => {
    expect(marginPercent(null, 12000)).toBeNull();
  });

  it('null — not Infinity — when there is no order value to divide by', () => {
    expect(marginPercent(-500, 0)).toBeNull();
    expect(marginPercent(-500, null)).toBeNull();
    expect(marginPercent(-500, undefined)).toBeNull();
  });
});

describe('costingTotals', () => {
  const row = (order_value: number | null, expense: number | null) => ({ job: { order_value }, expense });

  it('sums order value and priced expense', () => {
    const t = costingTotals([row(12000, 10000), row(8000, 5071.94)]);
    expect(t.orderValue).toBe(20000);
    expect(t.expense).toBeCloseTo(15071.94, 2);
    expect(t.priced).toBe(2);
    expect(t.difference).toBeCloseTo(4928.06, 2);
  });

  it('a row with no order value counts as 0 order value', () => {
    const t = costingTotals([row(null, 500)]);
    expect(t).toEqual({ orderValue: 0, expense: 500, priced: 1, difference: -500 });
  });

  it('empty sheet → all zeros', () => {
    expect(costingTotals([])).toEqual({ orderValue: 0, expense: 0, priced: 0, difference: 0 });
  });

  it('unpriced rows count toward order value but not the difference', () => {
    // One priced job (₹12,000 order, ₹10,000 material) and one not yet
    // priced (₹50,000 order). The difference compares priced rows only —
    // ₹2,000 — so the unpriced order never reads as pure margin.
    const t = costingTotals([row(12000, 10000), row(50000, null)]);
    expect(t.priced).toBe(1);
    expect(t.orderValue).toBe(62000);
    expect(t.expense).toBe(10000);
    expect(t.difference).toBe(2000);
  });

  it('totals are not rounded to paise (display formatting does that)', () => {
    const t = costingTotals([row(0, 0.1), row(0, 0.2)]);
    expect(t.expense).not.toBe(0.3);
    expect(formatInr(t.expense)).toBe('0.3');
  });
});

describe('parseInputNumber', () => {
  it('reads what a number input sends', () => {
    expect(parseInputNumber('250')).toBe(250);
    expect(parseInputNumber('1234.5')).toBe(1234.5);
    expect(parseInputNumber('12.')).toBe(12);   // half-typed decimal
  });

  it('null for blank and not-a-number', () => {
    expect(parseInputNumber('')).toBeNull();
    expect(parseInputNumber('   ')).toBeNull();
    expect(parseInputNumber('abc')).toBeNull();
    expect(parseInputNumber('Infinity')).toBeNull();
  });

  it('does NOT tolerate grouping commas (unlike the calculator’s parseField)', () => {
    expect(parseInputNumber('1,000')).toBeNull();
  });

  it('passes zero and negatives through (the caller validates)', () => {
    expect(parseInputNumber('0')).toBe(0);
    expect(parseInputNumber('-5')).toBe(-5);
  });
});

describe('formatInr', () => {
  it('Indian grouping, up to 2 decimals, no sign', () => {
    expect(formatInr(1234567.891)).toBe('12,34,567.89');
    expect(formatInr(10000)).toBe('10,000');
    expect(formatInr(0)).toBe('0');
  });

  it('dash for unknown', () => {
    expect(formatInr(null)).toBe('—');
    expect(formatInr(undefined)).toBe('—');
  });
});
