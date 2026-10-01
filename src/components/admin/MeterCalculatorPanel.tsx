'use client';
// src/components/admin/MeterCalculatorPanel.tsx
// Floating launcher + panel for the Job Separation calculators — same
// interaction shape as PrepressTodoPanel.tsx (itself modeled on NotesFeed's
// chat widget), stacked above all three so none of the floating widgets
// collide: NotesFeed at bottom-5, MessagesWidget at bottom-24,
// PrepressTodoPanel at bottom-[172px], this one at bottom-[248px] (same
// 76px rhythm throughout).
//
// Four calculators behind tabs. Basic is a standard Windows-style
// calculator (BasicCalculator.tsx). The other three are ported from the
// shop's "meter calculator" sheet (METER & RATE), each one equation:
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
// fields, so flipping between them loses nothing. The sums themselves —
// specs, rounding, runCalc — live in src/lib/meterCalculator.ts.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Calculator, RotateCcw, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BomMaterial } from '@/lib/types';
import { requestOpen, subscribeActiveWidget } from '@/lib/floatingWidgetCoordinator';
import { useResizablePanel } from '@/hooks/useResizablePanel';
import PanelResizeHandles from './PanelResizeHandles';
import BasicCalculator, { useBasicCalculator } from './BasicCalculator';
import { isBlank } from '@/lib/basicCalculator';
import { METER, GAP, RATE, runCalc, type CalcSpec, type FieldSpec } from '@/lib/meterCalculator';

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

type Tab = 'meter' | 'gap' | 'rate' | 'basic';
type SpecTab = Exclude<Tab, 'basic'>;

const TABS: { value: Tab; label: string }[] = [
  { value: 'meter', label: 'Meter' },
  { value: 'gap',   label: 'Gap' },
  { value: 'rate',  label: 'Rate' },
  { value: 'basic', label: 'Basic' },
];

const SPECS: Record<SpecTab, CalcSpec> = { meter: METER, gap: GAP, rate: RATE };

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
const INITIAL: Record<SpecTab, Record<string, string>> = {
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
    // Tall enough for the fullest tab (Basic's toolbar + display + six rows
    // of 44px keys) so the window never scrolls while typing.
    defaultWidth: 360,
    defaultHeight: 590,
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
    // defaultPrevented: Basic used this Escape to clear its sum.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) setOpen(false); };
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
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ meter: null, gap: null, rate: null, basic: null });
  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;

  const [values, setValues] = useState<Record<SpecTab, Record<string, string>>>(INITIAL);
  const basic = useBasicCalculator();
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

  function setField(key: string, value: string) {
    if (tab === 'basic') return;
    setValues((prev) => ({ ...prev, [tab]: { ...prev[tab], [key]: value } }));
  }

  // Clear resets only the tab in view — the others keep their numbers.
  // On Basic it's the C key (the history stays).
  const dirty = tab === 'basic'
    ? !isBlank(basic.state)
    : Object.entries(values[tab]).some(([k, v]) => v !== (INITIAL[tab][k] ?? '')) ||
      (tab === 'rate' && material !== '');

  function handleClear() {
    if (tab === 'basic') { basic.dispatch({ type: 'key', key: 'C' }); return; }
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
        aria-label="Calculator — meter, gap, rate and basic"
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

      <div className="flex flex-col overflow-y-auto px-4 py-3">
        <div
          role="tablist"
          aria-label="Calculator"
          onKeyDown={onTabKey}
          className="grid shrink-0 grid-cols-4 gap-1 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-1"
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

        <div
          id={fid('tabpanel')}
          role="tabpanel"
          aria-labelledby={fid(`tab-${tab}`)}
          // Basic's keypad grows into the panel's spare height.
          className={cn('mt-3', tab === 'basic' && 'flex flex-1 flex-col')}
        >
          {tab === 'rate' && (
            <div className="mb-2">
              <label htmlFor={fid('mat')} className={cn(captionCls, 'block text-center mb-1')}>Material</label>
              <input
                id={fid('mat')}
                type="text"
                list={fid('mat-list')}
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
                autoComplete="off"
                aria-label="Material (shown for the party, not used in the rate)"
                className={cn(fieldCls, 'font-semibold')}
              />
              <datalist id={fid('mat-list')}>
                {materialNames.map((name) => <option key={name} value={name} />)}
              </datalist>
            </div>
          )}

          {tab === 'basic' ? (
            <BasicCalculator state={basic.state} dispatch={basic.dispatch} />
          ) : (
            // key: each tab's fields are separate inputs, not reused ones.
            <CalcBody
              key={tab}
              spec={SPECS[tab]}
              values={values[tab]}
              onChange={setField}
              idFor={(k) => fid(`${tab}-${k}`)}
            />
          )}
        </div>
      </div>
    </section>
  );
}
