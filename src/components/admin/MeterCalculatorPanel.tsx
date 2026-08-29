'use client';
// src/components/admin/MeterCalculatorPanel.tsx
// Floating launcher + panel for the Job Separation Meter Calculator — same
// interaction shape as PrepressTodoPanel.tsx (itself modeled on NotesFeed's
// chat widget), stacked above both so none of the three floating widgets
// collide: NotesFeed at bottom-5, PrepressTodoPanel at bottom-24, this one
// at bottom-[172px] (same 76px rhythm as the 5→24 step).
//
// The metres formula matches the BOM calculator's previewMetreCalc
// (src/components/admin/BomManager.tsx) — no persistence here though;
// this is a pure client-side scratch tool, mounted only where
// canUseMeterCalculator is true (Job Separation).
//
// Unlike BOM, the operator here enters the cylinder (teeth) instead of a
// repeat length in mm directly — the shop's cylinders are specced by tooth
// count, and 3.175mm is the fixed gear pitch that converts teeth to the
// repeat's circumference in mm (cylinder × 3.175 = repeat).

import { useEffect, useId, useRef, useState } from 'react';
import { Calculator, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { requestOpen, subscribeActiveWidget } from '@/lib/floatingWidgetCoordinator';
import { useResizablePanel } from '@/hooks/useResizablePanel';
import PanelResizeHandles from './PanelResizeHandles';

const inputCls = cn(
  'w-full px-3.5 py-2.5 rounded-xl text-sm bg-[var(--glass-bg)] border border-[var(--glass-border)]',
  'text-[var(--glass-ink)] placeholder:text-[var(--glass-muted)] backdrop-blur-md font-mono',
  'focus:outline-none focus:border-emerald-300/70 focus:bg-white/[0.14]',
  'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
);
const btnCancel  = 'px-4 py-2 text-sm font-medium text-[var(--glass-muted)] hover:text-[var(--glass-ink)] transition-colors';
const btnPrimary = 'w-full px-4 py-3 text-sm font-semibold rounded-xl bg-brand-primary text-white hover:bg-brand-primary/90 disabled:opacity-40 transition-colors';

function formatNum(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString('en-IN');
  return n.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

// Fixed gear pitch (mm) that converts a cylinder's tooth count to the
// repeat's circumference in mm — see the file header comment.
const CYLINDER_PITCH_MM = 3.175;

type CalcResult = {
  repeat:        number; // derived: cylinder × CYLINDER_PITCH_MM
  totalMM:       number;
  labelsPerUp:   number;
  netMM:         number;
  netMetres:     number;
  wastageMetres: number;
  totalMetres:   number; // net + wastage, rounded up — never round down a request
  wastagePct:    number;
};

// Pure, so the step-by-step breakdown and the headline number can never drift apart.
function calculateMetres(qty: number, cylinder: number, ups: number, wastagePct: number): CalcResult | null {
  if (!qty || qty <= 0 || !cylinder || cylinder <= 0 || !ups || ups < 1) return null;

  const repeat        = cylinder * CYLINDER_PITCH_MM;
  const totalMM        = qty * repeat;
  const labelsPerUp    = qty / ups;
  const netMM          = labelsPerUp * repeat;
  const netMetres      = netMM / 1000;
  const wastageMetres  = netMetres * (wastagePct / 100);
  const totalMetres    = Math.ceil(netMetres + wastageMetres);

  return { repeat, totalMM, labelsPerUp, netMM, netMetres, wastageMetres, totalMetres, wastagePct };
}

export default function MeterCalculatorPanel() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const { resizable, style: resizeStyle, startResize } = useResizablePanel({
    id: 'meter-calculator',
    defaultWidth: 380,
    defaultHeight: 620,
    minWidth: 300,
    minHeight: 340,
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
  const wasteId    = useId();

  const [qty, setQty]           = useState('');
  const [cylinder, setCylinder] = useState('');
  const [ups, setUps]           = useState('1');
  const [wastage, setWastage]   = useState('0');
  const [result, setResult]     = useState<CalcResult | null>(null);
  const [error, setError]       = useState('');

  function handleCalculate() {
    const qtyNum      = parseFloat(qty);
    const cylinderNum = parseFloat(cylinder);
    const upsNum      = parseFloat(ups);
    const wastageNum  = parseFloat(wastage) || 0;

    if (!qtyNum || !cylinderNum || !upsNum) {
      setError('Fill in quantity, cylinder, and ups.');
      setResult(null);
      return;
    }
    if (upsNum < 1) {
      setError('Number of ups must be at least 1.');
      setResult(null);
      return;
    }

    setError('');
    setResult(calculateMetres(qtyNum, cylinderNum, upsNum, wastageNum));
  }

  function handleClear() {
    setQty('');
    setCylinder('');
    setUps('1');
    setWastage('0');
    setResult(null);
    setError('');
  }

  function onFieldKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCalculate();
    }
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
        !resizable && 'bottom-[172px] right-5 w-[min(92vw,380px)] max-h-[min(80vh,620px)]',
        'bg-brand-surface border border-brand-border rounded-2xl',
        'shadow-2xl shadow-black/20 overflow-hidden',
      )}
    >
      {resizable && <PanelResizeHandles onResizeStart={startResize} />}
      <header className="flex items-center justify-between gap-2 px-4 h-12 bg-brand-header text-white shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <Calculator className="h-4 w-4 shrink-0" aria-hidden="true" />
          <h2 className="text-sm font-semibold">Meter Calculator</h2>
        </div>
        <button
          onClick={() => setOpen(false)}
          aria-label="Close Meter Calculator"
          className="p-2 rounded-lg text-white/75 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>

      <div className="overflow-y-auto p-5">
        <div className="mb-4 flex flex-col gap-1 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3.5 py-2.5 font-mono text-xs text-[var(--glass-muted)]">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className="text-emerald-200 font-semibold shrink-0">FORMULA</span>
            <span>Cylinder × 3.175 = Repeat (mm)</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className="text-emerald-200 font-semibold shrink-0 opacity-0" aria-hidden="true">FORMULA</span>
            <span>Qty × Repeat ÷ Ups ÷ 1000 = Metres</span>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor={qtyId} className="flex items-baseline justify-between text-xs font-medium text-[var(--glass-muted)] uppercase tracking-wide mb-1.5">
              Label quantity <span className="normal-case font-normal opacity-60">number of labels</span>
            </label>
            <input
              id={qtyId}
              type="number"
              inputMode="numeric"
              min={0}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              onKeyDown={onFieldKeyDown}
              placeholder="e.g. 10000"
              className={inputCls}
            />
          </div>

          <div>
            <label htmlFor={cylinderId} className="flex items-baseline justify-between text-xs font-medium text-[var(--glass-muted)] uppercase tracking-wide mb-1.5">
              Cylinder <span className="normal-case font-normal opacity-60">teeth</span>
            </label>
            <input
              id={cylinderId}
              type="number"
              inputMode="decimal"
              min={0}
              step={0.1}
              value={cylinder}
              onChange={(e) => setCylinder(e.target.value)}
              onKeyDown={onFieldKeyDown}
              placeholder="e.g. 88"
              className={inputCls}
            />
          </div>

          <div>
            <label htmlFor={upsId} className="flex items-baseline justify-between text-xs font-medium text-[var(--glass-muted)] uppercase tracking-wide mb-1.5">
              Number of ups <span className="normal-case font-normal opacity-60">labels across web</span>
            </label>
            <input
              id={upsId}
              type="number"
              inputMode="numeric"
              min={1}
              value={ups}
              onChange={(e) => setUps(e.target.value)}
              onKeyDown={onFieldKeyDown}
              placeholder="e.g. 1"
              className={inputCls}
            />
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-4 py-3">
            <label htmlFor={wasteId} className="flex-1 text-sm text-[var(--glass-muted)]">
              Add wastage
            </label>
            <input
              id={wasteId}
              type="number"
              inputMode="numeric"
              min={0}
              max={50}
              value={wastage}
              onChange={(e) => setWastage(e.target.value)}
              onKeyDown={onFieldKeyDown}
              className={cn(inputCls, 'w-20 text-center px-2 py-1.5')}
            />
            <span className="text-sm font-semibold text-[var(--glass-muted)]">%</span>
          </div>
        </div>

        {error && <p className="text-xs text-red-300 mt-2">{error}</p>}

        <button onClick={handleCalculate} className={cn(btnPrimary, 'mt-4')}>
          Calculate Metres
        </button>

        {result && (
          <div className="mt-5 pt-5 border-t border-[var(--glass-border)]">
            <div className="text-center pb-4">
              <div className="font-mono text-4xl font-bold text-emerald-200">
                {formatNum(result.totalMetres)} m
              </div>
              <div className="text-xs text-[var(--glass-muted)] uppercase tracking-wide mt-1.5">
                Total job metres (with wastage)
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 border-t border-[var(--glass-border)] pt-4">
              <div className="rounded-lg bg-white/[0.06] border border-white/10 px-3.5 py-3">
                <div className="font-mono text-sm font-semibold text-[var(--glass-ink)]">
                  {formatNum(parseFloat(result.repeat.toFixed(2)))} mm
                </div>
                <div className="text-xs text-[var(--glass-muted)] mt-0.5">Repeat length</div>
              </div>
              <div className="rounded-lg bg-white/[0.06] border border-white/10 px-3.5 py-3">
                <div className="font-mono text-sm font-semibold text-[var(--glass-ink)]">
                  {formatNum(result.labelsPerUp)}
                </div>
                <div className="text-xs text-[var(--glass-muted)] mt-0.5">Labels per up</div>
              </div>
              <div className="rounded-lg bg-white/[0.06] border border-white/10 px-3.5 py-3">
                <div className="font-mono text-sm font-semibold text-[var(--glass-ink)]">
                  {formatNum(parseFloat(result.netMetres.toFixed(2)))} m
                </div>
                <div className="text-xs text-[var(--glass-muted)] mt-0.5">Net metres</div>
              </div>
              <div className="rounded-lg bg-white/[0.06] border border-white/10 px-3.5 py-3">
                <div className="font-mono text-sm font-semibold text-[var(--glass-ink)]">
                  {formatNum(parseFloat(result.wastageMetres.toFixed(2)))} m
                </div>
                <div className="text-xs text-[var(--glass-muted)] mt-0.5">Wastage metres</div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-[var(--glass-border)] space-y-1 font-mono text-xs text-[var(--glass-muted)]">
              <p><span className="text-emerald-200 font-semibold">1.</span> {formatNum(parseFloat(cylinder))} × 3.175 = <span className="text-[var(--glass-ink)]">{formatNum(parseFloat(result.repeat.toFixed(2)))} mm (repeat)</span></p>
              <p><span className="text-emerald-200 font-semibold">2.</span> {formatNum(parseFloat(qty))} × {formatNum(parseFloat(result.repeat.toFixed(2)))} mm = <span className="text-[var(--glass-ink)]">{formatNum(result.totalMM)} mm</span></p>
              <p><span className="text-emerald-200 font-semibold">3.</span> {formatNum(result.totalMM)} mm ÷ {formatNum(parseFloat(ups))} ups = <span className="text-[var(--glass-ink)]">{formatNum(result.netMM)} mm</span></p>
              <p><span className="text-emerald-200 font-semibold">4.</span> {formatNum(result.netMM)} mm ÷ 1000 = <span className="text-[var(--glass-ink)]">{formatNum(parseFloat(result.netMetres.toFixed(2)))} metres (net)</span></p>
              <p><span className="text-emerald-200 font-semibold">5.</span> Wastage {result.wastagePct}% = <span className="text-[var(--glass-ink)]">{formatNum(parseFloat(result.wastageMetres.toFixed(2)))} m</span></p>
              <p><span className="text-emerald-200 font-semibold">6.</span> Total = <span className="text-emerald-200 font-semibold">{formatNum(result.totalMetres)} metres</span></p>
            </div>
          </div>
        )}

        <div className="flex justify-end mt-5">
          <button onClick={handleClear} className={btnCancel}>
            Clear
          </button>
        </div>
      </div>
    </section>
  );
}
