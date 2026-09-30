// src/lib/meterCalculator.ts
// The maths behind the Job Separation calculators (MeterCalculatorPanel):
// the three one-equation specs ported from the shop's "meter calculator"
// sheet, the rounding each answer gets, and runCalc, which works out the
// one empty field from the rest. No React here, so the sums can be tested
// without rendering the panel.

// Fixed gear pitch (mm) converting a cylinder's tooth count to its repeat.
export const CYLINDER_PITCH_MM = 3.175;
export const MM_PER_INCH = 25.4;

export function formatNum(n: number, maxDigits = 2): string {
  return n.toLocaleString('en-IN', { maximumFractionDigits: maxDigits });
}

export function formatRupees(n: number, digits = 2): string {
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** Trims float noise (279.40000000000003) before formatting. */
export function round2(n: number): number {
  return parseFloat(n.toFixed(2));
}

// Ups and metres round one way on purpose (whole ups that fit, metres never
// short) — from 2 decimals, not the raw float, so 2.0000001 ups stays 2.
// A quantity rounds to the nearest label instead: the totals it's worked
// back from are themselves rounded (₹11,195.74 gives 23,299.99… labels,
// which is 23,300), and a label either way doesn't matter.
export const floorWhole = (n: number) => Math.floor(round2(n));
export const ceilWhole  = (n: number) => Math.ceil(round2(n));
export const nearestWhole = (n: number) => Math.round(n);

/** What's typed → a number (null when blank, NaN when not a number). Commas
 *  and ₹ are tolerated, since a solved value is shown formatted and may be
 *  edited in place. */
export function parseField(raw: string): number | null {
  const cleaned = raw.replace(/[,₹\s]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

// ── The solver ─────────────────────────────────────────────────────

export type Values = Record<string, number>;

export type FieldSpec = {
  key:         string;
  label:       string;
  ariaLabel:   string;
  /** A typed value must pass this to count. Default: above zero. */
  valid?:      (n: number) => boolean;
  /** How a solved value is presented — whole labels round down, etc. */
  round:       (n: number) => number;
  format:      (n: number) => string;
  unit?:       string;   // headline only: shown after the number
  prefix?:     string;   // headline only: shown before it
};

export type Solved = { value: number } | { error: string };

export type CalcSpec = {
  /** Last field is the headline answer, drawn big. */
  fields:   FieldSpec[];
  /** Work out `missing` from the rest (all present and valid). */
  solve:    (v: Values, missing: string) => Solved;
  /** Derivation rows — gets whatever is known so far, shows what it can. */
  readout:  (v: Partial<Values>, solvedKey: string | null) => [string, string][];
  /** Warning about the finished numbers (a gap that's negative, …). */
  warn?:    (v: Values) => string | null;
};

const positive   = (n: number) => n > 0;
const atLeastOne = (n: number) => n >= 1;
const has = (v: Partial<Values>, ...keys: string[]) => keys.every((k) => v[k] !== undefined);

export const METER: CalcSpec = {
  fields: [
    { key: 'qty', label: 'Qty', ariaLabel: 'Label quantity',
      round: nearestWhole, format: (n) => formatNum(n, 0) },
    { key: 'cyl', label: 'Cylinder', ariaLabel: 'Cylinder, in teeth',
      round: round2, format: (n) => formatNum(n) },
    { key: 'ups', label: 'Ups', ariaLabel: 'Number of ups', valid: atLeastOne,
      round: ceilWhole, format: (n) => formatNum(n, 0) },
    // Never round a material request down.
    { key: 'metres', label: 'Total metres', ariaLabel: 'Total metres', unit: 'm',
      round: ceilWhole, format: (n) => formatNum(n) },
  ],
  solve(v, missing) {
    const P = CYLINDER_PITCH_MM;
    switch (missing) {
      case 'metres': return { value: (v.cyl * P * v.qty) / v.ups / 1000 };
      case 'qty':    return { value: (v.metres * 1000 * v.ups) / (v.cyl * P) };
      case 'cyl':    return { value: (v.metres * 1000 * v.ups) / (P * v.qty) };
      // Ups needed to get the qty out of those metres — at least one.
      default:       return { value: Math.max(1, (v.cyl * P * v.qty) / (v.metres * 1000)) };
    }
  },
  readout(v) {
    const rows: [string, string][] = [];
    if (has(v, 'cyl')) rows.push(['Repeat (cyl × 3.175)', `${formatNum(round2(v.cyl! * CYLINDER_PITCH_MM))} mm`]);
    if (has(v, 'qty', 'ups')) rows.push(['Labels per up', formatNum(v.qty! / v.ups!)]);
    if (has(v, 'cyl', 'qty', 'ups')) {
      rows.push(['Net (before rounding)', `${formatNum(round2((v.cyl! * CYLINDER_PITCH_MM * v.qty!) / v.ups! / 1000))} m`]);
    }
    return rows;
  },
};

export const GAP: CalcSpec = {
  fields: [
    { key: 'cyl', label: 'Cylinder', ariaLabel: 'Cylinder, in teeth',
      round: round2, format: (n) => formatNum(n) },
    { key: 'length', label: 'Length (mm)', ariaLabel: 'Label length, in mm',
      round: round2, format: (n) => formatNum(n) },
    // Whole labels that fit round the cylinder — the readout gives the gap that leaves.
    { key: 'ups', label: 'Ups', ariaLabel: 'Number of ups', valid: atLeastOne,
      round: floorWhole, format: (n) => formatNum(n, 0) },
    { key: 'gap', label: 'Gap between labels', ariaLabel: 'Gap between labels, in mm', unit: 'mm',
      valid: (n) => n >= 0, round: round2, format: (n) => formatNum(n) },
  ],
  solve(v, missing) {
    const repeat = v.cyl * CYLINDER_PITCH_MM;
    switch (missing) {
      case 'gap': return { value: repeat / v.ups - v.length };
      case 'length': {
        const length = repeat / v.ups - v.gap;
        return length > 0 ? { value: length } : { error: 'The gap alone fills the cylinder — no room for a label.' };
      }
      case 'cyl': return { value: ((v.length + v.gap) * v.ups) / CYLINDER_PITCH_MM };
      default: {
        const ups = repeat / (v.length + v.gap);
        return ups >= 1 ? { value: ups } : { error: 'Label plus gap is longer than this cylinder.' };
      }
    }
  },
  readout(v, solvedKey) {
    const rows: [string, string][] = [];
    if (!has(v, 'cyl')) return rows;
    const repeat = v.cyl! * CYLINDER_PITCH_MM;
    rows.push(['Repeat (cyl × 3.175)', `${formatNum(round2(repeat))} mm`]);
    if (has(v, 'ups')) rows.push(['Repeat per up', `${formatNum(round2(repeat / v.ups!))} mm`]);
    // Ups were rounded down to whole labels, so the real gap is wider than asked.
    if (solvedKey === 'ups' && has(v, 'ups', 'length')) {
      rows.push([`Actual gap at ${formatNum(v.ups!, 0)} ups`, `${formatNum(round2(repeat / v.ups! - v.length!))} mm`]);
    }
    return rows;
  },
  warn(v) {
    const gap = (v.cyl * CYLINDER_PITCH_MM) / v.ups - v.length;
    if (gap >= 0) return null;
    return `Labels overlap — ${formatNum(round2(-gap))} mm too long for this cylinder at ${formatNum(v.ups, 0)} ${v.ups === 1 ? 'up' : 'ups'}.`;
  },
};

// ₹ per label = sq in × rate (paise) ÷ 100.
export const perLabel = (h: number, w: number, rate: number) => ((h * w) / (MM_PER_INCH * MM_PER_INCH)) * rate / 100;

export const RATE: CalcSpec = {
  fields: [
    { key: 'h', label: 'Height (mm)', ariaLabel: 'Label height, in mm',
      round: round2, format: (n) => formatNum(n) },
    { key: 'w', label: 'Width (mm)', ariaLabel: 'Label width, in mm',
      round: round2, format: (n) => formatNum(n) },
    { key: 'rate', label: 'Rate / sq in', ariaLabel: 'Rate per square inch, in paise',
      round: (n) => parseFloat(n.toFixed(4)), format: (n) => formatNum(n, 4) },
    { key: 'qty', label: 'Qty', ariaLabel: 'Label quantity',
      round: nearestWhole, format: (n) => formatNum(n, 0) },
    { key: 'total', label: 'Total amount', ariaLabel: 'Total amount, in rupees', prefix: '₹',
      round: round2, format: (n) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
  ],
  solve(v, missing) {
    // total = k × h × w × rate × qty — one product, so any factor is the
    // total over the product of the others.
    const k = 1 / (MM_PER_INCH * MM_PER_INCH * 100);
    const others = ['h', 'w', 'rate', 'qty'].filter((f) => f !== missing).reduce((p, f) => p * v[f], k);
    return { value: missing === 'total' ? others : v.total / others };
  },
  readout(v) {
    const rows: [string, string][] = [];
    if (has(v, 'h', 'w')) rows.push(['Area (h × w ÷ 25.4²)', `${formatNum(round2((v.h! * v.w!) / (MM_PER_INCH * MM_PER_INCH)))} sq in`]);
    if (has(v, 'h', 'w', 'rate')) rows.push(['Rate per label', formatRupees(perLabel(v.h!, v.w!, v.rate!), 4)]);
    return rows;
  },
};

export type Outcome = {
  known:     Partial<Values>;        // typed values, plus the solved one (rounded)
  solvedKey: string | null;
  display:   Record<string, string>; // the solved field's formatted value
  hint:      string | null;
  error:     string | null;
  warning:   string | null;
};

/** Pure: the typed fields → which one to solve, its value, and what to say. */
export function runCalc(spec: CalcSpec, raw: Record<string, string>): Outcome {
  const known: Partial<Values> = {};
  const empty: string[] = [];
  let invalid: string | null = null;

  for (const f of spec.fields) {
    const n = parseField(raw[f.key] ?? '');
    if (n === null) { empty.push(f.key); continue; }
    if (Number.isNaN(n) || !(f.valid ?? positive)(n)) { invalid ??= f.label; continue; }
    known[f.key] = n;
  }

  const base: Outcome = { known, solvedKey: null, display: {}, hint: null, error: null, warning: null };
  const count = spec.fields.length;

  if (invalid) return { ...base, error: `Check ${invalid.toLowerCase()} — that value won’t work.` };
  if (empty.length === count) return { ...base, hint: `Fill any ${count - 1} — the empty one is worked out.` };
  if (empty.length === 0) return { ...base, hint: 'All filled — clear the one you want worked out.' };
  if (empty.length > 1) {
    return { ...base, hint: `${empty.length} empty — fill ${empty.length - 1} more; the last empty one is worked out.` };
  }

  const missing = empty[0];
  const field = spec.fields.find((f) => f.key === missing)!;
  const result = spec.solve(known as Values, missing);
  if ('error' in result) return { ...base, error: result.error };
  if (!Number.isFinite(result.value)) return { ...base, error: 'Those numbers don’t work out.' };

  const value = field.round(result.value);
  const full = { ...known, [missing]: value } as Values;
  return {
    known: full,
    solvedKey: missing,
    display: { [missing]: field.format(value) },
    hint: null,
    error: null,
    warning: spec.warn?.(full) ?? null,
  };
}
