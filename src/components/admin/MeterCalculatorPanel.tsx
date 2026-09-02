'use client';
// src/components/admin/MeterCalculatorPanel.tsx
// Floating launcher + panel for the Job Separation Meter Calculator — same
// interaction shape as PrepressTodoPanel.tsx (itself modeled on NotesFeed's
// chat widget), stacked above both so none of the three floating widgets
// collide: NotesFeed at bottom-5, PrepressTodoPanel at bottom-24, this one
// at bottom-[172px] (same 76px rhythm as the 5→24 step).
//
// Three inputs, one answer. The operator enters the cylinder (teeth) rather
// than a repeat length in mm — the shop's cylinders are specced by tooth
// count, and 3.175mm is the fixed gear pitch that converts teeth to the
// repeat's circumference (cylinder × 3.175 = repeat). The metres formula
// itself matches the BOM calculator's previewMetreCalc
// (src/components/admin/BomManager.tsx); nothing is persisted here — this is
// a pure client-side scratch tool, mounted only where canUseMeterCalculator
// is true (Job Separation).
//
// The result recomputes on every keystroke instead of behind a Calculate
// button: with only three fields there's nothing to "submit", and a live
// answer removes both the button and the "fill in the fields" error state
// that used to make this panel twice as tall as it needed to be.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Calculator, RotateCcw, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { requestOpen, subscribeActiveWidget } from '@/lib/floatingWidgetCoordinator';
import { useResizablePanel } from '@/hooks/useResizablePanel';
import PanelResizeHandles from './PanelResizeHandles';

// Fixed gear pitch (mm) converting a cylinder's tooth count to its repeat.
const CYLINDER_PITCH_MM = 3.175;

const fieldCls = cn(
  'w-full h-11 px-2 rounded-xl text-center text-sm font-mono tabular-nums',
  'bg-[var(--field-bg)] border border-[var(--field-border)] text-[var(--glass-ink)]',
  'placeholder:text-[var(--glass-muted)] placeholder:font-sans',
  'focus:outline-none focus:border-emerald-300/70 focus:bg-white/[0.14]',
  'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)]',
  'transition-colors motion-reduce:transition-none',
  // Native number spinners would eat a third of a ~100px-wide field.
  '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none',
  '[&::-webkit-inner-spin-button]:appearance-none',
);

const headerBtnCls = cn(
  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg',
  'text-white/75 hover:text-white hover:bg-white/10',
  'transition-colors motion-reduce:transition-none',
);

const captionCls = 'text-[10px] font-medium uppercase tracking-[0.025em] text-[var(--glass-muted)]';

function formatNum(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString('en-IN');
  return n.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

/** Trims float noise (279.40000000000003) before formatting. */
function round2(n: number): number {
  return parseFloat(n.toFixed(2));
}

type CalcResult = {
  repeat:      number; // derived: cylinder × CYLINDER_PITCH_MM
  labelsPerUp: number;
  netMetres:   number;
  totalMetres: number; // rounded up — never round a material request down
};

// Pure, so the readout below and the headline number can never drift apart.
function calculateMetres(qty: number, cylinder: number, ups: number): CalcResult | null {
  if (!qty || qty <= 0 || !cylinder || cylinder <= 0 || !ups || ups < 1) return null;

  const repeat      = cylinder * CYLINDER_PITCH_MM;
  const labelsPerUp = qty / ups;
  const netMetres   = (labelsPerUp * repeat) / 1000;

  return { repeat, labelsPerUp, netMetres, totalMetres: Math.ceil(netMetres) };
}

// Module scope on purpose: an inline component would remount on every
// keystroke and drop the caret out of the field being typed in.
function Field({
  id, label, ariaLabel, value, onChange, placeholder, step,
}: {
  id: string;
  label: string;
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  step?: number;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={cn(captionCls, 'block text-center mb-1')}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={0}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={fieldCls}
      />
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

export default function MeterCalculatorPanel() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const { resizable, style: resizeStyle, startResize } = useResizablePanel({
    // Deliberately not the old "meter-calculator" key — this panel is far
    // smaller now, and anyone who resized the previous version would
    // otherwise reopen it at the old 380×620.
    id: 'meter-calculator-compact',
    // Tall enough for the fullest state (result + three readout rows) so the
    // window never scrolls or resizes itself while the operator is typing.
    defaultWidth: 360,
    defaultHeight: 336,
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

  const qtyId      = useId();
  const cylinderId = useId();
  const upsId      = useId();

  const [qty, setQty]           = useState('');
  const [cylinder, setCylinder] = useState('');
  const [ups, setUps]           = useState('1');

  const result = useMemo(
    () => calculateMetres(parseFloat(qty), parseFloat(cylinder), parseFloat(ups)),
    [qty, cylinder, ups],
  );

  const dirty = Boolean(qty || cylinder) || ups !== '1';

  function handleClear() {
    setQty('');
    setCylinder('');
    setUps('1');
  }

  // ── Launcher — stacked above PrepressTodoPanel's FAB (bottom-24) so
  // none of the three floating widgets overlap. ──────────────────────
  if (!open) {
    return (
      <button
        onClick={handleOpen}
        aria-label="Meter Calculator"
        className={cn(
          'fixed bottom-[172px] right-5 z-40 h-14 w-14 rounded-full',
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
      aria-label="Meter Calculator"
      style={resizeStyle}
      className={cn(
        'fixed z-50 grid grid-rows-[auto_minmax(0,1fr)]',
        !resizable && 'bottom-[172px] right-5 w-[min(92vw,360px)] max-h-[80vh]',
        'bg-brand-surface border border-brand-border rounded-2xl',
        'shadow-2xl shadow-black/20 overflow-hidden',
      )}
    >
      {resizable && <PanelResizeHandles onResizeStart={startResize} />}

      <header className="flex items-center justify-between gap-1 pl-4 pr-2 h-12 bg-brand-header text-white shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <Calculator className="h-4 w-4 shrink-0" aria-hidden="true" />
          <h2 className="text-sm font-semibold truncate">Meter Calculator</h2>
        </div>
        <div className="flex items-center shrink-0">
          {dirty && (
            <button onClick={handleClear} aria-label="Clear the calculator" title="Clear" className={headerBtnCls}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          <button onClick={() => setOpen(false)} aria-label="Close Meter Calculator" className={headerBtnCls}>
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="overflow-y-auto px-4 py-4">
        <div className="grid grid-cols-3 gap-2">
          <Field
            id={qtyId}
            label="Qty"
            ariaLabel="Label quantity"
            value={qty}
            onChange={setQty}
            placeholder="10000"
          />
          <Field
            id={cylinderId}
            label="Cylinder"
            ariaLabel="Cylinder, in teeth"
            value={cylinder}
            onChange={setCylinder}
            placeholder="88"
            step={0.1}
          />
          <Field
            id={upsId}
            label="Ups"
            ariaLabel="Number of ups, labels across the web"
            value={ups}
            onChange={setUps}
            placeholder="1"
          />
        </div>

        {/* The answer. aria-live so it's announced as the operator types
            rather than staying silent without a submit button to trigger it. */}
        <div
          aria-live="polite"
          className="mt-4 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-4 py-3 text-center"
        >
          {result ? (
            <>
              <p className="font-mono tabular-nums text-[2rem] leading-none font-bold text-emerald-200">
                {formatNum(result.totalMetres)}
                <span className="text-base font-semibold ml-1">m</span>
              </p>
              <p className={cn(captionCls, 'mt-1.5')}>Total metres</p>
            </>
          ) : (
            <>
              <p className="font-mono text-[2rem] leading-none font-bold text-[var(--glass-muted)]">—</p>
              <p className={cn(captionCls, 'mt-1.5')}>Fill all three fields</p>
            </>
          )}
        </div>

        {result && (
          <dl className="mt-3 space-y-1.5 font-mono tabular-nums text-[11px] text-[var(--glass-muted)]">
            <ReadoutRow term="Repeat (cyl × 3.175)">{formatNum(round2(result.repeat))} mm</ReadoutRow>
            <ReadoutRow term="Labels per up">{formatNum(result.labelsPerUp)}</ReadoutRow>
            <ReadoutRow term="Net (before rounding)">{formatNum(round2(result.netMetres))} m</ReadoutRow>
          </dl>
        )}
      </div>
    </section>
  );
}
