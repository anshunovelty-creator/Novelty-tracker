'use client';
// src/components/admin/MeterCalculatorPanel.tsx
// Floating launcher + panel for the Job Separation calculators — same
// interaction shape as PrepressTodoPanel.tsx (itself modeled on NotesFeed's
// chat widget), stacked above all three so none of the floating widgets
// collide: NotesFeed at bottom-5, MessagesWidget at bottom-24,
// PrepressTodoPanel at bottom-[172px], this one at bottom-[248px] (same
// 76px rhythm throughout).
//
// Three calculators behind tabs, ported from the shop's "meter calculator"
// sheet (METER & RATE). Each is one equation:
//   Meter — metres = tooth × 3.175 × qty ÷ ups ÷ 1000
//   Gap   — gap    = tooth × 3.175 ÷ ups − length
//   Rate  — total  = h × w ÷ 25.4² (sq in) × rate ÷ 100 (paise → ₹) × qty
// and every field, the answer included, is an input: fill all but one and
// the empty one is worked out from the rest — "what cylinder gives 336 m?",
// "how many labels for ₹10,000?". Material on Rate is a label only, there
// so a screenshot sent to the party names the stock.
//
// The operator enters the cylinder in teeth rather than a repeat in mm — the
// shop's cylinders are specced by tooth count, and 3.175mm is the fixed gear
// pitch that converts teeth to the repeat's circumference. Nothing is
// persisted — pure client-side scratch tools, mounted only where
// canUseMeterCalculator is true (Job Separation). Each tab keeps its own
// fields, so flipping between them loses nothing.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Calculator, RotateCcw, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BomMaterial } from '@/lib/types';
import { requestOpen, subscribeActiveWidget } from '@/lib/floatingWidgetCoordinator';
import { useResizablePanel } from '@/hooks/useResizablePanel';
import PanelResizeHandles from './PanelResizeHandles';

// Fixed gear pitch (mm) converting a cylinder's tooth count to its repeat.
const CYLINDER_PITCH_MM = 3.175;
const MM_PER_INCH = 25.4;

const fieldCls = cn(
  'w-full h-11 px-2 rounded-xl text-center text-sm font-mono tabular-nums',
  'bg-[var(--field-bg)] border border-[var(--field-border)] text-[var(--glass-ink)]',
  'placeholder:text-[var(--glass-muted)] placeholder:font-sans',
  'focus:outline-none focus:border-emerald-300/70 focus:bg-white/[0.14]',
  'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)]',
  'transition-colors motion-reduce:transition-none',
);

// A field the calculator filled in: reads as an answer, not as something typed.
const solvedFieldCls = 'border-emerald-300/70 bg-[var(--glass-bg)] font-bold text-emerald-200';

const headerBtnCls = cn(
  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg',
  'text-white/75 hover:text-white hover:bg-white/10',
  'transition-colors motion-reduce:transition-none',
);

const captionCls = 'text-[10px] font-medium uppercase tracking-[0.025em] text-[var(--glass-muted)]';

function formatNum(n: number, maxDigits = 2): string {
  return n.toLocaleString('en-IN', { maximumFractionDigits: maxDigits });
}

function formatRupees(n: number, digits = 2): string {
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** Trims float noise (279.40000000000003) before formatting. */
function round2(n: number): number {
  return parseFloat(n.toFixed(2));
}

// Ups and metres round one way on purpose (whole ups that fit, metres never
// short) — from 2 decimals, not the raw float, so 2.0000001 ups stays 2.
// A quantity rounds to the nearest label instead: the totals it's worked
// back from are themselves rounded (₹11,195.74 gives 23,299.99… labels,
// which is 23,300), and a label either way doesn't matter.
const floorWhole = (n: number) => Math.floor(round2(n));
const ceilWhole  = (n: number) => Math.ceil(round2(n));
const nearestWhole = (n: number) => Math.round(n);

/** What's typed → a number (null when blank, NaN when not a number). Commas
 *  and ₹ are tolerated, since a solved value is shown formatted and may be
 *  edited in place. */
function parseField(raw: string): number | null {
  const cleaned = raw.replace(/[,₹\s]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

// ── The solver ─────────────────────────────────────────────────────

type Values = Record<string, number>;

type FieldSpec = {
  key:         string;
  label:       string;
  ariaLabel:   string;
  placeholder: string;
  /** A typed value must pass this to count. Default: above zero. */
  valid?:      (n: number) => boolean;
  /** How a solved value is presented — whole labels round down, etc. */
  round:       (n: number) => number;
  format:      (n: number) => string;
  unit?:       string;   // headline only: shown after the number
  prefix?:     string;   // headline only: shown before it
};

type Solved = { value: number } | { error: string };

type CalcSpec = {
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

const METER: CalcSpec = {
  fields: [
    { key: 'qty', label: 'Qty', ariaLabel: 'Label quantity', placeholder: '10000',
      round: nearestWhole, format: (n) => formatNum(n, 0) },
    { key: 'cyl', label: 'Cylinder', ariaLabel: 'Cylinder, in teeth', placeholder: '88',
      round: round2, format: (n) => formatNum(n) },
    { key: 'ups', label: 'Ups', ariaLabel: 'Number of ups', placeholder: '1', valid: atLeastOne,
      round: ceilWhole, format: (n) => formatNum(n, 0) },
    // Never round a material request down.
    { key: 'metres', label: 'Total metres', ariaLabel: 'Total metres', placeholder: '336', unit: 'm',
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

const GAP: CalcSpec = {
  fields: [
    { key: 'cyl', label: 'Cylinder', ariaLabel: 'Cylinder, in teeth', placeholder: '75',
      round: round2, format: (n) => formatNum(n) },
    { key: 'length', label: 'Length (mm)', ariaLabel: 'Label length, in mm', placeholder: '230',
      round: round2, format: (n) => formatNum(n) },
    // Whole labels that fit round the cylinder — the readout gives the gap that leaves.
    { key: 'ups', label: 'Ups', ariaLabel: 'Number of ups', placeholder: '1', valid: atLeastOne,
      round: floorWhole, format: (n) => formatNum(n, 0) },
    { key: 'gap', label: 'Gap between labels', ariaLabel: 'Gap between labels, in mm', placeholder: '8.13', unit: 'mm',
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
const perLabel = (h: number, w: number, rate: number) => ((h * w) / (MM_PER_INCH * MM_PER_INCH)) * rate / 100;

const RATE: CalcSpec = {
  fields: [
    { key: 'h', label: 'Height (mm)', ariaLabel: 'Label height, in mm', placeholder: '77',
      round: round2, format: (n) => formatNum(n) },
    { key: 'w', label: 'Width (mm)', ariaLabel: 'Label width, in mm', placeholder: '122',
      round: round2, format: (n) => formatNum(n) },
    { key: 'rate', label: 'Rate / sq in', ariaLabel: 'Rate per square inch, in paise', placeholder: '3.3',
      round: (n) => parseFloat(n.toFixed(4)), format: (n) => formatNum(n, 4) },
    { key: 'qty', label: 'Qty', ariaLabel: 'Label quantity', placeholder: '23300',
      round: nearestWhole, format: (n) => formatNum(n, 0) },
    { key: 'total', label: 'Total amount', ariaLabel: 'Total amount, in rupees', placeholder: '—', prefix: '₹',
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

type Tab = 'meter' | 'gap' | 'rate';

const TABS: { value: Tab; label: string; spec: CalcSpec }[] = [
  { value: 'meter', label: 'Meter', spec: METER },
  { value: 'gap',   label: 'Gap',   spec: GAP },
  { value: 'rate',  label: 'Rate',  spec: RATE },
];

type Outcome = {
  known:     Partial<Values>;        // typed values, plus the solved one (rounded)
  solvedKey: string | null;
  display:   Record<string, string>; // the solved field's formatted value
  hint:      string | null;
  error:     string | null;
  warning:   string | null;
};

/** Pure: the typed fields → which one to solve, its value, and what to say. */
function runCalc(spec: CalcSpec, raw: Record<string, string>): Outcome {
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

// ── Pieces ─────────────────────────────────────────────────────────

/** Select-all when a solved field is focused, so typing replaces the answer
 *  instead of appending to it. The mouseup would otherwise drop the selection. */
function useSelectOnFocus() {
  const justFocused = useRef(false);
  return {
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => { justFocused.current = true; e.currentTarget.select(); },
    onMouseUp: (e: React.MouseEvent<HTMLInputElement>) => {
      if (justFocused.current) { e.preventDefault(); justFocused.current = false; }
    },
  };
}

type FieldProps = {
  id: string;
  spec: FieldSpec;
  value: string;
  solvedValue: string | undefined;
  onChange: (value: string) => void;
};

// Module scope on purpose: an inline component would remount on every
// keystroke and drop the caret out of the field being typed in.
function Field({ id, spec, value, solvedValue, onChange }: FieldProps) {
  const select = useSelectOnFocus();
  const solved = solvedValue !== undefined;
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={cn(captionCls, 'block text-center mb-1', solved && 'text-emerald-200')}>
        {spec.label}{solved && <span aria-hidden="true"> · auto</span>}
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={solved ? solvedValue : value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={spec.placeholder}
        aria-label={solved ? `${spec.ariaLabel} (worked out)` : spec.ariaLabel}
        className={cn(fieldCls, solved && solvedFieldCls)}
        {...(solved ? select : {})}
      />
    </div>
  );
}

/** The answer field, drawn big. Typed into like any other — leave it empty
 *  to have it worked out, fill it to work out one of the fields above. */
function Headline({ id, spec, value, solvedValue, onChange }: FieldProps) {
  const select = useSelectOnFocus();
  const solved = solvedValue !== undefined;
  const shown = solved ? solvedValue : value;
  const tone = solved ? 'text-emerald-200' : 'text-[var(--glass-muted)]';
  return (
    <div
      className={cn(
        'mt-4 rounded-xl border px-4 py-3 text-center transition-colors motion-reduce:transition-none',
        'focus-within:border-emerald-300/70 focus-within:shadow-[0_0_0_4px_rgba(124,240,190,0.22)]',
        solved ? 'border-emerald-300/70 bg-[var(--glass-bg)]' : 'border-[var(--field-border)] bg-[var(--field-bg)]',
      )}
    >
      <div className="flex items-baseline justify-center font-mono tabular-nums text-[2rem] leading-none font-bold">
        {spec.prefix && <span className={cn('text-[1.5rem]', tone)}>{spec.prefix}</span>}
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={shown}
          onChange={(e) => onChange(e.target.value)}
          placeholder="—"
          aria-label={solved ? `${spec.ariaLabel} (worked out)` : spec.ariaLabel}
          aria-live="polite"
          size={Math.max(3, shown.length)}
          className={cn(
            'min-w-0 max-w-full bg-transparent text-center outline-none',
            'placeholder:text-[var(--glass-muted)]',
            solved ? 'text-emerald-200' : 'text-[var(--glass-ink)]',
          )}
          {...(solved ? select : {})}
        />
        {spec.unit && <span className={cn('text-base font-semibold ml-1', tone)}>{spec.unit}</span>}
      </div>
      <label htmlFor={id} className={cn(captionCls, 'block mt-1.5')}>
        {spec.label}{solved && ' · worked out'}
      </label>
    </div>
  );
}

/** One right-aligned figure in the derivation readout under the result. */
function ReadoutRow({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="truncate">{term}</dt>
      <dd className="shrink-0 text-[var(--glass-ink)]">{children}</dd>
    </div>
  );
}

function CalcBody({
  spec, values, onChange, idFor,
}: {
  spec: CalcSpec;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  idFor: (key: string) => string;
}) {
  const outcome = useMemo(() => runCalc(spec, values), [spec, values]);
  const inputs = spec.fields.slice(0, -1);
  const headline = spec.fields[spec.fields.length - 1];
  const rows = spec.readout(outcome.known, outcome.solvedKey);
  const problem = outcome.error ?? outcome.warning;

  return (
    <>
      <div className={cn('grid gap-2', inputs.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
        {inputs.map((f) => (
          <Field
            key={f.key}
            id={idFor(f.key)}
            spec={f}
            value={values[f.key] ?? ''}
            solvedValue={outcome.display[f.key]}
            onChange={(v) => onChange(f.key, v)}
          />
        ))}
      </div>

      <Headline
        id={idFor(headline.key)}
        spec={headline}
        value={values[headline.key] ?? ''}
        solvedValue={outcome.display[headline.key]}
        onChange={(v) => onChange(headline.key, v)}
      />

      {problem ? (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs text-red-300">
          <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" aria-hidden="true" />
          {problem}
        </p>
      ) : outcome.hint ? (
        <p className="mt-2 text-center text-[11px] text-[var(--glass-muted)]">{outcome.hint}</p>
      ) : null}

      {rows.length > 0 && (
        <dl className="mt-3 space-y-1.5 font-mono tabular-nums text-[11px] text-[var(--glass-muted)]">
          {rows.map(([term, value]) => <ReadoutRow key={term} term={term}>{value}</ReadoutRow>)}
        </dl>
      )}
    </>
  );
}

// Ups start at 1 — the common case, and one less field to fill.
const INITIAL: Record<Tab, Record<string, string>> = {
  meter: { ups: '1' },
  gap:   { ups: '1' },
  rate:  {},
};

export default function MeterCalculatorPanel() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const { resizable, style: resizeStyle, startResize } = useResizablePanel({
    // New key with the tabs: a size saved for the tab-less panel would open
    // this one too short and scroll.
    id: 'meter-calculator-tabs',
    // Tall enough for the fullest tab (Rate's material + two field rows +
    // answer + hint + readout) so the window never scrolls while typing.
    defaultWidth: 360,
    defaultHeight: 530,
    minWidth: 300,
    minHeight: 260,
    anchorRight: 20,
    anchorBottom: 172,
    open,
  });

  // Close this widget whenever another floating widget (chat, To-Do) opens
  // — see floatingWidgetCoordinator.ts.
  useEffect(() => {
    if (!open) return;
    return subscribeActiveWidget((activeId) => {
      if (activeId !== 'meter-calculator') setOpen(false);
    });
  }, [open]);

  // Escape and click/tap-outside both close the panel — same
  // transient-overlay behavior as PrepressTodoPanel and NotesFeed.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onPointerDown = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  function handleOpen() {
    requestOpen('meter-calculator');
    setOpen(true);
  }

  const [tab, setTab] = useState<Tab>('meter');
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ meter: null, gap: null, rate: null });
  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;

  const [values, setValues] = useState<Record<Tab, Record<string, string>>>(INITIAL);
  const [material, setMaterial] = useState('');

  // Material suggestions from the BOM master. The calculator is open to
  // departments without BOM access, so a refused fetch just means no
  // suggestions — the field stays free text either way.
  const materialsQuery = useQuery({
    queryKey: ['bom-materials'],
    queryFn: async () => {
      const res  = await fetch('/api/bom-materials');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load materials');
      return (data.materials ?? []) as BomMaterial[];
    },
    enabled: open && tab === 'rate',
    retry: false,
    staleTime: 5 * 60_000,
  });
  const materialNames = useMemo(
    () => (materialsQuery.data ?? []).filter((m) => m.is_active).map((m) => m.name),
    [materialsQuery.data],
  );

  const current = TABS.find((t) => t.value === tab)!;

  function setField(key: string, value: string) {
    setValues((prev) => ({ ...prev, [tab]: { ...prev[tab], [key]: value } }));
  }

  // Clear resets only the tab in view — the others keep their numbers.
  const initial = INITIAL[tab];
  const dirty =
    Object.entries(values[tab]).some(([k, v]) => v !== (initial[k] ?? '')) ||
    (tab === 'rate' && material !== '');

  function handleClear() {
    setValues((prev) => ({ ...prev, [tab]: INITIAL[tab] }));
    if (tab === 'rate') setMaterial('');
  }

  // Arrow keys move between tabs (WAI-ARIA tabs pattern).
  function onTabKey(e: React.KeyboardEvent) {
    const i = TABS.findIndex((t) => t.value === tab);
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next === null) return;
    e.preventDefault();
    const t = TABS[next].value;
    setTab(t);
    tabRefs.current[t]?.focus();
  }

  // ── Launcher — stacked above PrepressTodoPanel's FAB (bottom-[172px])
  // so none of the floating widgets overlap. ─────────────────────────
  if (!open) {
    return (
      <button
        onClick={handleOpen}
        aria-label="Calculator — meter, gap and rate"
        className={cn(
          'fixed bottom-[248px] right-5 z-40 h-14 w-14 rounded-full',
          'bg-brand-primary hover:bg-brand-primary-hover text-white',
          'shadow-lg shadow-black/20 flex items-center justify-center',
          'transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-primary/40',
        )}
      >
        <Calculator className="h-6 w-6" aria-hidden="true" />
      </button>
    );
  }

  // ── Panel ───────────────────────────────────────────────────────
  return (
    <section
      ref={panelRef}
      aria-label="Calculator"
      style={resizeStyle}
      className={cn(
        'fixed z-50 grid grid-rows-[auto_minmax(0,1fr)]',
        !resizable && 'bottom-[248px] right-5 w-[min(92vw,360px)] max-h-[80vh]',
        'bg-brand-surface border border-brand-border rounded-2xl',
        'shadow-2xl shadow-black/20 overflow-hidden',
      )}
    >
      {resizable && <PanelResizeHandles onResizeStart={startResize} />}

      <header className="flex items-center justify-between gap-1 pl-4 pr-2 h-12 bg-brand-header text-white shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <Calculator className="h-4 w-4 shrink-0" aria-hidden="true" />
          <h2 className="text-sm font-semibold truncate">Calculator</h2>
        </div>
        <div className="flex items-center shrink-0">
          {dirty && (
            <button onClick={handleClear} aria-label="Clear this calculator" title="Clear" className={headerBtnCls}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          <button onClick={() => setOpen(false)} aria-label="Close calculator" className={headerBtnCls}>
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="overflow-y-auto px-4 py-3">
        <div
          role="tablist"
          aria-label="Calculator"
          onKeyDown={onTabKey}
          className="grid grid-cols-3 gap-1 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-1"
        >
          {TABS.map((t) => (
            <button
              key={t.value}
              ref={(el) => { tabRefs.current[t.value] = el; }}
              id={fid(`tab-${t.value}`)}
              type="button"
              role="tab"
              aria-selected={tab === t.value}
              aria-controls={fid('tabpanel')}
              tabIndex={tab === t.value ? 0 : -1}
              onClick={() => setTab(t.value)}
              className={cn(
                'min-h-11 rounded-lg text-sm font-medium transition-colors motion-reduce:transition-none',
                tab === t.value
                  ? 'bg-brand-primary text-white'
                  : 'text-[var(--glass-muted)] hover:text-[var(--glass-ink)] hover:bg-white/[0.06]',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div id={fid('tabpanel')} role="tabpanel" aria-labelledby={fid(`tab-${tab}`)} className="mt-3">
          {tab === 'rate' && (
            <div className="mb-2">
              <label htmlFor={fid('mat')} className={cn(captionCls, 'block text-center mb-1')}>Material</label>
              <input
                id={fid('mat')}
                type="text"
                list={fid('mat-list')}
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
                placeholder="e.g. AM89240F"
                autoComplete="off"
                aria-label="Material (shown for the party, not used in the rate)"
                className={cn(fieldCls, 'font-semibold')}
              />
              <datalist id={fid('mat-list')}>
                {materialNames.map((name) => <option key={name} value={name} />)}
              </datalist>
            </div>
          )}

          {/* key: each tab's fields are separate inputs, not reused ones. */}
          <CalcBody
            key={tab}
            spec={current.spec}
            values={values[tab]}
            onChange={setField}
            idFor={(k) => fid(`${tab}-${k}`)}
          />
        </div>
      </div>
    </section>
  );
}
