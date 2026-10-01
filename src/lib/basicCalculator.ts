// src/lib/basicCalculator.ts
// The maths behind the Basic tab of the Job Separation calculator — a
// standard four-function calculator that behaves like the Windows one the
// floor already knows: operators chain left to right (5 + 3 × 2 = 16), a
// second = repeats the last operation, % means "percent of" after + and −,
// and the unary keys (1/x, x², √x, ±) wrap the entry in the line above.
//
// Everything is one reducer — state and action in, state out — so the panel
// stays a thin view and the behaviour is testable without rendering. Results
// are cleaned to 15 significant digits, so 0.1 + 0.2 reads 0.3, not
// 0.30000000000000004. Numbers group the Indian way (12,34,567) like the
// other calculators.

export type Op = '+' | '−' | '×' | '÷';

export type CalcKey =
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.'
  | Op | '=' | '%' | 'CE' | 'C' | 'back' | 'neg' | 'inv' | 'sqr' | 'sqrt';

export type HistoryItem = { expr: string; result: string };

export type CalcState = {
  /** The number in the display, as a plain string ("-12.5", "0.", "1e+21"). */
  entry:     string;
  /** Left operand waiting for the right one. */
  acc:       number | null;
  op:        Op | null;
  /** The line above the display ("12 + ", "5 + 3 ="). */
  expr:      string;
  /** The entry as an expression when a unary key wrapped it ("√(9)"). */
  entryExpr: string | null;
  /** The next digit starts a new entry instead of extending this one. */
  fresh:     boolean;
  /** A right-hand operand has been given since the operator. */
  typed:     boolean;
  /** The display holds the answer of an =. */
  done:      boolean;
  /** What a further = repeats. */
  last:      { op: Op; operand: number } | null;
  error:     string | null;
  /** Newest first. */
  history:   HistoryItem[];
};

export type CalcAction =
  | { type: 'key'; key: CalcKey }
  | { type: 'paste'; text: string }
  | { type: 'clearHistory' };

export const MAX_DIGITS = 16;
export const MAX_HISTORY = 50;

export const INITIAL_CALC: CalcState = {
  entry: '0', acc: null, op: null, expr: '', entryExpr: null,
  fresh: false, typed: false, done: false, last: null, error: null, history: [],
};

// ── Numbers ────────────────────────────────────────────────────────

/** Trims float noise to 15 significant digits; `+ 0` turns -0 into 0. */
export function clean(n: number): number {
  return parseFloat(n.toPrecision(15)) + 0;
}

/** A computed number → the entry string the display shows. */
export function toEntry(n: number): string {
  const c = clean(n);
  const abs = Math.abs(c);
  if (abs !== 0 && (abs >= 1e16 || abs < 1e-6)) return c.toExponential();
  return String(c);
}

/** "1234567" → "12,34,567" (lakh grouping), on a string of digits. */
function groupIndian(int: string): string {
  if (int.length <= 3) return int;
  return `${int.slice(0, -3).replace(/\B(?=(\d{2})+$)/g, ',')},${int.slice(-3)}`;
}

/** An entry string as the display shows it. Works on the string, not a
 *  number, so what's being typed survives as typed: "12." keeps its dot,
 *  "1.50" its zero, and 16 digits don't lose precision. */
export function formatEntry(entry: string): string {
  if (entry.includes('e')) return entry;
  const neg = entry.startsWith('-');
  const body = neg ? entry.slice(1) : entry;
  const dot = body.indexOf('.');
  const int = dot === -1 ? body : body.slice(0, dot);
  const frac = dot === -1 ? '' : body.slice(dot);
  return `${neg ? '-' : ''}${groupIndian(int || '0')}${frac}`;
}

const fmt = (n: number) => formatEntry(toEntry(n));

const digitCount = (entry: string) => entry.replace(/[^0-9]/g, '').length;

/** Pasted text → a number, or null. Grouping commas, spaces and ₹ are
 *  tolerated, so a value copied from elsewhere in the app pastes cleanly. */
export function parsePasted(text: string): number | null {
  const cleaned = text.trim().replace(/[,₹\s]/g, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

type Result = { value: number } | { error: string };

function finite(n: number): Result {
  return Number.isFinite(n) ? { value: clean(n) } : { error: 'Overflow' };
}

function apply(a: number, op: Op, b: number): Result {
  if (op === '÷') {
    if (b === 0) return { error: a === 0 ? 'Result is undefined' : 'Cannot divide by zero' };
    return finite(a / b);
  }
  if (op === '×') return finite(a * b);
  if (op === '−') return finite(a - b);
  return finite(a + b);
}

// ── The reducer ────────────────────────────────────────────────────

const OPS: readonly string[] = ['+', '−', '×', '÷'];
const isDigitKey = (k: string) => /^[0-9.]$/.test(k);

/** Back to a blank calculator, history kept. */
const reset = (s: CalcState): CalcState => ({ ...INITIAL_CALC, history: s.history });

const withHistory = (s: CalcState, item: HistoryItem) => [item, ...s.history].slice(0, MAX_HISTORY);

function digit(s: CalcState, d: string): CalcState {
  if (s.done) s = reset(s);
  if (s.fresh || s.entryExpr !== null) {
    return { ...s, entry: d === '.' ? '0.' : d, entryExpr: null, fresh: false, typed: true };
  }
  if (d === '.') return s.entry.includes('.') ? s : { ...s, entry: `${s.entry}.`, typed: true };
  if (digitCount(s.entry) >= MAX_DIGITS) return s;
  if (s.entry === '0' || s.entry === '-0') return { ...s, entry: s.entry.replace('0', d), typed: true };
  return { ...s, entry: `${s.entry}${d}`, typed: true };
}

function operator(s: CalcState, op: Op): CalcState {
  const value = Number(s.entry);
  if (s.op !== null && s.typed) {
    // Chained: work out what's pending first (5 + 3 × → 8 ×).
    const r = apply(s.acc!, s.op, value);
    if ('error' in r) return { ...s, error: r.error, expr: `${fmt(s.acc!)} ${s.op} ${s.entryExpr ?? fmt(value)} ${op}` };
    return { ...s, acc: r.value, op, entry: toEntry(r.value), expr: `${fmt(r.value)} ${op} `, entryExpr: null, fresh: true, typed: false, done: false };
  }
  // First operator, a changed one, or one straight after an = (carries on from the answer).
  const left = s.op !== null ? s.acc! : value;
  const leftExpr = s.op === null ? s.entryExpr ?? fmt(left) : fmt(left);
  return { ...s, acc: left, op, expr: `${leftExpr} ${op} `, entryExpr: null, fresh: true, typed: false, done: false };
}

function equals(s: CalcState): CalcState {
  const value = Number(s.entry);
  let left: number, op: Op, right: number, expr: string;
  if (s.op !== null) {
    // "5 + =" uses the 5 again, as on Windows — the display still shows it.
    // The pending line already reads "√(81) + ", so it's built on as is.
    left = s.acc!; op = s.op; right = value;
    expr = `${s.expr}${s.entryExpr ?? fmt(value)} =`;
  } else if (s.last && s.done) {
    // A further = repeats the last operation on the answer.
    left = value; op = s.last.op; right = s.last.operand;
    expr = `${fmt(left)} ${op} ${fmt(right)} =`;
  } else {
    // A lone number (or a wrapped one, like √(9)) — nothing to work out.
    const expr = `${s.entryExpr ?? fmt(value)} =`;
    const history = s.entryExpr ? withHistory(s, { expr, result: fmt(value) }) : s.history;
    return { ...s, expr, entryExpr: null, fresh: true, typed: false, done: true, history };
  }
  const r = apply(left, op, right);
  if ('error' in r) return { ...s, error: r.error, expr, acc: null, op: null };
  const entry = toEntry(r.value);
  return {
    ...s, entry, acc: null, op: null, expr, entryExpr: null,
    fresh: true, typed: false, done: true, last: { op, operand: right },
    history: withHistory(s, { expr, result: formatEntry(entry) }),
  };
}

function unary(s: CalcState, key: 'inv' | 'sqr' | 'sqrt' | 'neg'): CalcState {
  if (key === 'neg' && !s.fresh && s.entryExpr === null) {
    // Still typing: flip the sign in place.
    return { ...s, entry: s.entry.startsWith('-') ? s.entry.slice(1) : `-${s.entry}` };
  }
  const value = Number(s.entry);
  const inner = s.entryExpr ?? fmt(value);
  const label = { inv: `1/(${inner})`, sqr: `sqr(${inner})`, sqrt: `√(${inner})`, neg: `negate(${inner})` }[key];
  let r: Result;
  if (key === 'inv') r = value === 0 ? { error: 'Cannot divide by zero' } : finite(1 / value);
  else if (key === 'sqr') r = finite(value * value);
  else if (key === 'sqrt') r = value < 0 ? { error: 'Invalid input' } : finite(Math.sqrt(value));
  else r = { value: clean(-value) };
  // After an =, the wrapped answer starts a new sum and the old line goes.
  const base = s.done ? reset(s) : s;
  if ('error' in r) return { ...base, error: r.error, expr: `${base.expr}${label}` };
  return { ...base, entry: toEntry(r.value), entryExpr: label, fresh: true, typed: true, done: false };
}

function percent(s: CalcState): CalcState {
  const value = Number(s.entry);
  // 200 + 10% → 200 + 20 (percent of the running total); 200 × 10% → 200 × 0.1.
  const n = clean(s.op === '+' || s.op === '−' ? s.acc! * value / 100 : value / 100);
  const base = s.done ? reset(s) : s;
  return { ...base, entry: toEntry(n), entryExpr: fmt(n), fresh: true, typed: true, done: false };
}

export function calcReducer(s: CalcState, a: CalcAction): CalcState {
  if (a.type === 'clearHistory') return { ...s, history: [] };

  if (a.type === 'paste') {
    const n = parsePasted(a.text);
    if (n === null) return s;
    const base = s.done || s.error ? reset(s) : s;
    const entry = toEntry(n);
    // A pasted number can be typed onto, like one keyed in — unless it's
    // too long or in e-notation to extend.
    const fresh = entry.includes('e') || digitCount(entry) > MAX_DIGITS;
    return { ...base, entry, entryExpr: null, fresh, typed: true, done: false };
  }

  const key = a.key;
  if (key === 'C') return reset(s);
  if (s.error) {
    // Only clearing or a new number gets out of an error, as on Windows.
    if (key === 'CE' || key === 'back') return reset(s);
    if (isDigitKey(key)) return digit(reset(s), key);
    return s;
  }
  if (isDigitKey(key)) return digit(s, key);
  if (OPS.includes(key)) return operator(s, key as Op);
  switch (key) {
    case '=': return equals(s);
    case '%': return percent(s);
    case 'CE':
      // After an = there's no entry of its own to clear, so CE clears the lot.
      return s.done ? reset(s) : { ...s, entry: '0', entryExpr: null, fresh: false, typed: s.op !== null };
    case 'back': {
      // An answer isn't edited digit by digit — Backspace just drops its line.
      if (s.done) return { ...s, expr: '' };
      if (s.fresh || s.entryExpr !== null) return s;
      const entry = s.entry.slice(0, -1);
      return { ...s, entry: entry === '' || entry === '-' ? '0' : entry };
    }
    default:
      return unary(s, key as 'inv' | 'sqr' | 'sqrt' | 'neg');
  }
}

/** True when there's nothing to clear (history aside). */
export function isBlank(s: CalcState): boolean {
  return s.entry === '0' && s.expr === '' && s.op === null && s.error === null;
}
