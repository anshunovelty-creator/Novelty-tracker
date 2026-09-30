// src/lib/meterCalculator.test.ts
// The Meter / Gap / Rate calculators, driven the way the panel drives them:
// raw strings in, runCalc out. Values are the shop's own — 88- and 96-tooth
// cylinders, 50 × 40 mm labels, rates in paise per square inch.

import { describe, expect, it } from 'vitest';
import {
  CYLINDER_PITCH_MM, METER, GAP, RATE, runCalc, parseField,
  round2, floorWhole, ceilWhole, nearestWhole, type CalcSpec,
} from './meterCalculator';

/** runCalc with number-or-string fields; a missing key is an empty field. */
function calc(spec: CalcSpec, fields: Record<string, number | string>) {
  const raw: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) raw[k] = String(v);
  return runCalc(spec, raw);
}

/** The solved number, failing loudly if runCalc didn't solve. */
function solved(spec: CalcSpec, fields: Record<string, number | string>): number {
  const out = calc(spec, fields);
  expect(out.error).toBeNull();
  expect(out.solvedKey).not.toBeNull();
  return out.known[out.solvedKey!]!;
}

// ── Helpers ─────────────────────────────────────────────────────────

describe('parseField', () => {
  it('reads plain and decimal numbers', () => {
    expect(parseField('88')).toBe(88);
    expect(parseField('3.13')).toBe(3.13);
  });

  it('tolerates Indian grouping commas, ₹ and spaces (a solved value edited in place)', () => {
    expect(parseField('1,00,000')).toBe(100000);
    expect(parseField('₹4,650.01')).toBe(4650.01);
    expect(parseField(' 2 794 ')).toBe(2794);
  });

  it('is null for blank, NaN for not-a-number', () => {
    expect(parseField('')).toBeNull();
    expect(parseField('   ')).toBeNull();
    expect(parseField('abc')).toBeNaN();
    expect(parseField('12..5')).toBeNaN();
    expect(parseField('Infinity')).toBeNaN();
  });

  it('passes negatives and zero through (validity is the field spec’s job)', () => {
    expect(parseField('-5')).toBe(-5);
    expect(parseField('0')).toBe(0);
  });

  it('accepts anything Number() does — exponent and hex notation included', () => {
    // Current behaviour, harmless in practice: nobody types these on the floor.
    expect(parseField('1e3')).toBe(1000);
    expect(parseField('0x10')).toBe(16);
  });
});

describe('rounding helpers', () => {
  it('round2 trims float noise', () => {
    expect(round2(279.40000000000003)).toBe(279.4);
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(3.13333)).toBe(3.13);
  });

  it('floorWhole: whole ups that fit, from 2 dp so float noise stays down', () => {
    expect(floorWhole(2.0000001)).toBe(2);
    expect(floorWhole(2.994)).toBe(2);
    expect(floorWhole(3.99)).toBe(3);
  });

  it('floorWhole rounds UP when the value is within 0.005 below a whole number', () => {
    // Current behaviour: round2(2.996) is 3.00, so floor gives 3 even though
    // only 2.996 ups fit. See the Gap tab's overlap test below.
    expect(floorWhole(2.995)).toBe(3);
    expect(floorWhole(2.996)).toBe(3);
  });

  it('ceilWhole: never short, but 2 dp noise does not add a whole unit', () => {
    expect(ceilWhole(2794.0000000000005)).toBe(2794);
    expect(ceilWhole(2794.004)).toBe(2794);
    expect(ceilWhole(2794.006)).toBe(2795);
    expect(ceilWhole(2794.2794)).toBe(2795);
  });

  it('nearestWhole rounds to the NEAREST label — not floor (the recent fix)', () => {
    expect(nearestWhole(23299.99)).toBe(23300);
    expect(nearestWhole(23300.49)).toBe(23300);
    expect(nearestWhole(23300.5)).toBe(23301);   // x.5 goes up
    expect(nearestWhole(9999.999999)).toBe(10000);
    expect(nearestWhole(0.4)).toBe(0);
  });
});

// ── runCalc: shared behaviour ───────────────────────────────────────

describe('runCalc — hints and input checks', () => {
  it('all empty → says how many to fill', () => {
    const out = calc(METER, {});
    expect(out.hint).toBe('Fill any 3 — the empty one is worked out.');
    expect(out.solvedKey).toBeNull();
    expect(out.error).toBeNull();
  });

  it('all filled → asks for one to be cleared, solves nothing', () => {
    const out = calc(METER, { qty: 10000, cyl: 88, ups: 1, metres: 2794 });
    expect(out.hint).toBe('All filled — clear the one you want worked out.');
    expect(out.solvedKey).toBeNull();
  });

  it('two empty → asks for one more', () => {
    const out = calc(METER, { cyl: 88, ups: 1 });
    expect(out.hint).toBe('2 empty — fill 1 more; the last empty one is worked out.');
    expect(out.solvedKey).toBeNull();
  });

  it('five-field Rate counts its own fields', () => {
    expect(calc(RATE, {}).hint).toBe('Fill any 4 — the empty one is worked out.');
    expect(calc(RATE, { h: 50 }).hint).toBe('4 empty — fill 3 more; the last empty one is worked out.');
  });

  it.each([
    ['zero',     '0'],
    ['negative', '-10000'],
    ['text',     'abc'],
  ])('%s quantity is rejected by name', (_, qty) => {
    const out = calc(METER, { qty, cyl: 88, ups: 1 });
    expect(out.error).toBe('Check qty — that value won’t work.');
    expect(out.solvedKey).toBeNull();
  });

  it('ups must be at least 1', () => {
    expect(calc(METER, { qty: 10000, cyl: 88, ups: 0.5 }).error).toBe('Check ups — that value won’t work.');
    expect(calc(METER, { qty: 10000, cyl: 88, ups: 1 }).error).toBeNull();
  });

  it('an invalid field wins over the empty-count hints, and the first one is named', () => {
    const out = calc(METER, { qty: -1, cyl: 0 });
    expect(out.error).toBe('Check qty — that value won’t work.');
    expect(out.hint).toBeNull();
  });

  it('keeps the typed values in `known` even when it cannot solve', () => {
    const out = calc(METER, { cyl: 88, ups: 2 });
    expect(out.known).toEqual({ cyl: 88, ups: 2 });
  });

  it('a non-finite answer becomes an error, not Infinity on screen', () => {
    // Heights and widths so small their product underflows to 0 — the
    // divide-by-zero guard for "any factor = total ÷ product of the others".
    const out = calc(RATE, { h: '1e-200', w: '1e-200', rate: 15, total: 100 });
    expect(out.error).toBe('Those numbers don’t work out.');
    expect(out.solvedKey).toBeNull();
  });
});

// ── Meter: metres = tooth × 3.175 × qty ÷ ups ÷ 1000 ────────────────

describe('Meter tab', () => {
  it('forward: 10,000 labels on an 88-tooth cylinder, 1 up → 2,794 m', () => {
    const out = calc(METER, { qty: 10000, cyl: 88, ups: 1 });
    expect(out.solvedKey).toBe('metres');
    expect(out.known.metres).toBe(2794);        // raw is 2794.0000000000005 — no extra metre
    expect(out.display.metres).toBe('2,794');
    expect(out.warning).toBeNull();
  });

  it('forward: 2 ups halves the metres', () => {
    expect(solved(METER, { qty: 10000, cyl: 88, ups: 2 })).toBe(1397);
  });

  it('forward: metres round UP — a material request is never short', () => {
    // 279.4 × 10,001 ÷ 1000 = 2,794.2794
    expect(solved(METER, { qty: 10001, cyl: 88, ups: 1 })).toBe(2795);
  });

  it('backward: qty from metres', () => {
    const out = calc(METER, { cyl: 88, ups: 1, metres: 2794 });
    expect(out.solvedKey).toBe('qty');
    expect(out.known.qty).toBe(10000);
    expect(out.display.qty).toBe('10,000');
  });

  it('backward: qty rounds to the nearest label, not down', () => {
    // 1000 m on a 96-tooth (304.8 mm) repeat, 1 up = 3,280.84 labels
    expect(solved(METER, { cyl: 96, ups: 1, metres: 1000 })).toBe(3281);
  });

  it('backward: cylinder from metres — "what cylinder gives 336 m?"', () => {
    expect(solved(METER, { qty: 10000, ups: 1, metres: 2794 })).toBe(88);
    // 336 m for 1,200 labels at 1 up → 88.19 teeth (2 dp, not whole)
    expect(solved(METER, { qty: 1200, ups: 1, metres: 336 })).toBe(88.19);
  });

  it('backward: ups needed to get the qty out of those metres', () => {
    expect(solved(METER, { qty: 10000, cyl: 88, metres: 1397 })).toBe(2);
  });

  it('backward: ups round UP (2.794 needed → 3)', () => {
    expect(solved(METER, { qty: 10000, cyl: 88, metres: 1000 })).toBe(3);
  });

  it('backward: ups never drop below 1, even with metres to spare', () => {
    // 10,000 labels need 2,794 m at 1 up; 5,000 m would be 0.56 ups
    expect(solved(METER, { qty: 10000, cyl: 88, metres: 5000 })).toBe(1);
  });

  it('round trip: metres from qty, then qty back from those metres', () => {
    const metres = solved(METER, { qty: 25000, cyl: 96, ups: 3 });
    expect(metres).toBe(2540);
    expect(solved(METER, { cyl: 96, ups: 3, metres })).toBe(25000);
    expect(solved(METER, { qty: 25000, ups: 3, metres })).toBe(96);
    expect(solved(METER, { qty: 25000, cyl: 96, metres })).toBe(3);
  });

  it('round trip through a rounded-up metre is only as exact as that metre', () => {
    // 10,001 labels → 2,795 m (ceil). The extra 0.72 m buys 2.58 more labels,
    // so working back gives 10,004 — within one metre’s worth (~3.6 labels).
    const metres = solved(METER, { qty: 10001, cyl: 88, ups: 1 });
    const qty = solved(METER, { cyl: 88, ups: 1, metres });
    expect(qty).toBe(10004);
    expect(Math.abs(qty - 10001)).toBeLessThanOrEqual(Math.ceil(1000 / (88 * CYLINDER_PITCH_MM)));
  });

  it('readout shows what it can from what is known', () => {
    expect(METER.readout({}, null)).toEqual([]);
    expect(METER.readout({ cyl: 88 }, null)).toEqual([['Repeat (cyl × 3.175)', '279.4 mm']]);
    const out = calc(METER, { qty: 10001, cyl: 88, ups: 1 });
    expect(METER.readout(out.known, out.solvedKey)).toEqual([
      ['Repeat (cyl × 3.175)', '279.4 mm'],
      ['Labels per up', '10,001'],
      ['Net (before rounding)', '2,794.28 m'],
    ]);
  });
});

// ── Gap: gap = tooth × 3.175 ÷ ups − length ────────────────────────

describe('Gap tab', () => {
  it('forward: 88-tooth, 90 mm label, 3 ups → 3.13 mm gap', () => {
    const out = calc(GAP, { cyl: 88, length: 90, ups: 3 });
    expect(out.solvedKey).toBe('gap');
    expect(out.known.gap).toBe(3.13);
    expect(out.display.gap).toBe('3.13');
    expect(out.warning).toBeNull();
  });

  it('forward: a label that fills its up with room to spare has no warning', () => {
    const out = calc(GAP, { cyl: 96, length: 100, ups: 3 });   // 101.6 − 100
    expect(out.known.gap).toBe(1.6);
    expect(out.warning).toBeNull();
  });

  it('forward: a label too long for the cylinder solves to a negative gap, with a warning', () => {
    const out = calc(GAP, { cyl: 88, length: 100, ups: 3 });
    expect(out.known.gap).toBe(-6.87);
    expect(out.error).toBeNull();
    expect(out.warning).toBe('Labels overlap — 6.87 mm too long for this cylinder at 3 ups.');
  });

  it('warning says "up" for a single up', () => {
    const out = calc(GAP, { cyl: 88, length: 300, ups: 1 });
    expect(out.warning).toBe('Labels overlap — 20.6 mm too long for this cylinder at 1 up.');
  });

  it('a typed gap may be 0 but not negative', () => {
    expect(calc(GAP, { cyl: 88, ups: 3, gap: 0 }).error).toBeNull();
    expect(calc(GAP, { cyl: 88, ups: 3, gap: -1 }).error).toBe('Check gap between labels — that value won’t work.');
  });

  it('backward: length from the gap', () => {
    expect(solved(GAP, { cyl: 88, ups: 3, gap: 3 })).toBe(90.13);
  });

  it('backward: length errors when the gap alone fills the up', () => {
    const out = calc(GAP, { cyl: 88, ups: 3, gap: 93.14 });
    expect(out.error).toBe('The gap alone fills the cylinder — no room for a label.');
    // Exactly equal is also "no room" (length must be > 0).
    expect(calc(GAP, { cyl: 96, ups: 3, gap: 101.6 }).error).toBe('The gap alone fills the cylinder — no room for a label.');
  });

  it('backward: cylinder from length + gap', () => {
    // (90 + 3.13) × 3 ÷ 3.175 = 87.997 → 88.00
    expect(solved(GAP, { length: 90, ups: 3, gap: 3.13 })).toBe(88);
  });

  it('backward: ups round DOWN to whole labels that fit, readout gives the real gap', () => {
    // 279.4 ÷ (90 + 3) = 3.004 ups → 3
    const out = calc(GAP, { cyl: 88, length: 90, gap: 3 });
    expect(out.solvedKey).toBe('ups');
    expect(out.known.ups).toBe(3);
    expect(GAP.readout(out.known, out.solvedKey)).toEqual([
      ['Repeat (cyl × 3.175)', '279.4 mm'],
      ['Repeat per up', '93.13 mm'],
      ['Actual gap at 3 ups', '3.13 mm'],
    ]);
    // 279.4 ÷ (90 + 5) = 2.94 → 2, not 3
    expect(solved(GAP, { cyl: 88, length: 90, gap: 5 })).toBe(2);
  });

  it('backward: ups errors when label + gap is longer than the cylinder', () => {
    expect(calc(GAP, { cyl: 88, length: 280, gap: 0 }).error).toBe('Label plus gap is longer than this cylinder.');
  });

  it('round trip: gap from length, then length back from that gap', () => {
    const gap = solved(GAP, { cyl: 96, length: 95, ups: 3 });   // 304.8/3 − 95 = 6.6
    expect(gap).toBe(6.6);
    expect(solved(GAP, { cyl: 96, ups: 3, gap })).toBe(95);
    expect(solved(GAP, { length: 95, ups: 3, gap })).toBe(96);
    expect(solved(GAP, { cyl: 96, length: 95, gap })).toBe(3);
  });

  it('readout only shows the actual-gap row when ups were worked out', () => {
    const out = calc(GAP, { cyl: 88, length: 90, ups: 3 });
    expect(GAP.readout(out.known, out.solvedKey).map(([t]) => t)).toEqual(['Repeat (cyl × 3.175)', 'Repeat per up']);
    expect(GAP.readout({ length: 90 }, null)).toEqual([]);
  });

  // ── Suspected bugs: current behaviour pinned, flagged for review ──

  it('SUSPECTED BUG: cylinder worked back from a 0 gap warns of a "0 mm" overlap', () => {
    // 50 mm labels, no gap, 3 ups → cyl = 150 ÷ 3.175 = 47.2441, shown as
    // 47.24. warn() recomputes the gap from that ROUNDED cylinder:
    // 47.24 × 3.175 ÷ 3 − 50 = −0.0043 mm, so it reports an overlap that
    // formats as "0 mm". The operator asked for 0 gap and gets an alarm.
    const out = calc(GAP, { length: 50, ups: 3, gap: 0 });
    expect(out.known.cyl).toBe(47.24);
    expect(out.error).toBeNull();
    expect(out.warning).toBe('Labels overlap — 0 mm too long for this cylinder at 3 ups.');
  });

  it('SUSPECTED BUG: a label that exactly fills its up shows a "-0" gap and an overlap warning', () => {
    // 96-tooth = 304.8 mm; ÷ 3 ups = 101.6 mm, so a 101.6 mm label leaves
    // exactly 0. In floating point 304.8 ÷ 3 − 101.6 is −1.4e-14: round2
    // keeps the sign (−0), the field shows "-0", and warn() — testing the
    // raw value, not the rounded one — reports a "0 mm" overlap.
    const out = calc(GAP, { cyl: 96, length: 101.6, ups: 3 });
    expect(Object.is(out.known.gap, -0)).toBe(true);
    expect(out.display.gap).toBe('-0');
    expect(out.warning).toBe('Labels overlap — 0 mm too long for this cylinder at 3 ups.');
  });

  it('SUSPECTED BUG: ups within 0.005 of the next whole number round up, then overlap', () => {
    // 88-tooth, 93.2 mm label, 0 gap: 279.4 ÷ 93.2 = 2.9979 ups. round2 → 3.00,
    // floor → 3 ups, which don't fit: the warning then contradicts the answer.
    const out = calc(GAP, { cyl: 88, length: 93.2, gap: 0 });
    expect(out.known.ups).toBe(3);
    expect(out.warning).toBe('Labels overlap — 0.07 mm too long for this cylinder at 3 ups.');
  });
});

// ── Rate: total = h × w ÷ 25.4² × rate ÷ 100 × qty ─────────────────

describe('Rate tab', () => {
  // 50 × 40 mm = 3.1 sq in; at 15 paise/sq in → ₹0.465 a label.
  const base = { h: 50, w: 40, rate: 15, qty: 10000 };

  it('forward: 10,000 labels of 50 × 40 mm at 15 p/sq in → ₹4,650.01', () => {
    const out = calc(RATE, base);
    expect(out.solvedKey).toBe('total');
    expect(out.known.total).toBe(4650.01);
    expect(out.display.total).toBe('4,650.01');
  });

  it('forward: total always shows two decimals', () => {
    const out = calc(RATE, { h: 25.4, w: 25.4, rate: 100, qty: 10 });   // 1 sq in × ₹1 × 10
    expect(out.known.total).toBe(10);
    expect(out.display.total).toBe('10.00');
  });

  it.each([
    ['h',    50],
    ['w',    40],
    ['rate', 15],
    ['qty',  10000],
  ] as const)('backward: %s from the rounded total', (key, expected) => {
    const fields: Record<string, number> = { ...base, total: 4650.01 };
    delete fields[key];
    expect(solved(RATE, fields)).toBe(expected);
  });

  it('backward: rate keeps 4 decimals', () => {
    const out = calc(RATE, { h: 50, w: 40, qty: 10000, total: 5000 });
    expect(out.known.rate).toBe(16.129);   // 16.12903… → 4 dp
    expect(out.display.rate).toBe('16.129');
  });

  it('backward: qty rounds to the NEAREST label when the total was itself rounded', () => {
    // 50 × 40 mm is 3.1000062 sq in, so 1,000 labels → ₹465.0009 → ₹465.00.
    // Working back from ₹465 gives 999.998 labels, which the fix reads as
    // 1,000 (floor used to give 999).
    const total = solved(RATE, { h: 50, w: 40, rate: 15, qty: 1000 });
    expect(total).toBe(465);
    const raw = RATE.solve({ h: 50, w: 40, rate: 15, total }, 'qty');
    expect('value' in raw && raw.value).toBeLessThan(1000);
    expect('value' in raw && Math.floor(raw.value)).toBe(999);
    expect(solved(RATE, { h: 50, w: 40, rate: 15, total })).toBe(1000);
  });

  it('backward: "how many labels for ₹10,000?"', () => {
    expect(solved(RATE, { h: 50, w: 40, rate: 15, total: 10000 })).toBe(21505);
  });

  it('backward: a total too small for one label gives 0 labels, not an error', () => {
    // Current behaviour: nearest-label rounding turns 0.43 labels into 0.
    const out = calc(RATE, { h: 50, w: 40, rate: 15, total: 0.2 });
    expect(out.error).toBeNull();
    expect(out.known.qty).toBe(0);
    expect(out.display.qty).toBe('0');
  });

  it('round trip on every field', () => {
    const fields = { h: 75, w: 50, rate: 22.5, qty: 5000 };
    const total = solved(RATE, fields);
    for (const key of ['h', 'w', 'rate', 'qty'] as const) {
      const rest: Record<string, number> = { ...fields, total };
      delete rest[key];
      expect(solved(RATE, rest)).toBeCloseTo(fields[key], key === 'rate' ? 4 : 2);
    }
  });

  it('a solved total edited in place (commas, ₹) parses back', () => {
    expect(solved(RATE, { h: 50, w: 40, rate: 15, total: '₹4,650.01' })).toBe(10000);
  });

  it('readout: area and rate per label', () => {
    expect(RATE.readout({ h: 50, w: 40, rate: 15 }, null)).toEqual([
      ['Area (h × w ÷ 25.4²)', '3.1 sq in'],
      ['Rate per label', '₹0.4650'],
    ]);
    expect(RATE.readout({ h: 50 }, null)).toEqual([]);
  });
});
