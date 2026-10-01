'use client';
// src/components/admin/BasicCalculator.tsx
// The Basic tab of MeterCalculatorPanel: a standard calculator laid out and
// behaving like the Windows one (same keys, same order, same keyboard
// shortcuts), drawn in the panel's own glass. The maths is calcReducer in
// src/lib/basicCalculator.ts; this file is the keypad, the display, the
// history list and the keyboard wiring.
//
// State lives in the panel (useBasicCalculator), not here, so switching
// tabs or closing the panel keeps the sum and its history — both still go
// on a page reload, like the other tabs' fields.
//
// Keys are read while this tab is showing, from anywhere on the page except
// a text field, so the calculator can be used straight after opening it.
// Window capture phase, so Escape (= C) is seen before the panel's own
// Escape-to-close; once there's nothing to clear, Escape closes as usual.

import { useEffect, useReducer, useRef, useState } from 'react';
import { Check, Copy, Delete, History, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  calcReducer, formatEntry, INITIAL_CALC, isBlank,
  type CalcAction, type CalcKey, type CalcState,
} from '@/lib/basicCalculator';

export function useBasicCalculator() {
  const [state, dispatch] = useReducer(calcReducer, INITIAL_CALC);
  return { state, dispatch };
}

type KeyDef = { key: CalcKey; label: React.ReactNode; aria: string; kind: 'num' | 'fn' | 'eq' };

// Windows Standard layout, row by row.
const KEYPAD: KeyDef[] = [
  { key: '%',    label: '%',  aria: 'Percent',     kind: 'fn' },
  { key: 'CE',   label: 'CE', aria: 'Clear entry', kind: 'fn' },
  { key: 'C',    label: 'C',  aria: 'Clear',       kind: 'fn' },
  { key: 'back', label: <Delete className="h-5 w-5" aria-hidden="true" />, aria: 'Backspace', kind: 'fn' },
  { key: 'inv',  label: <>1/<i>x</i></>,            aria: 'Reciprocal',  kind: 'fn' },
  { key: 'sqr',  label: <><i>x</i><sup>2</sup></>,  aria: 'Square',      kind: 'fn' },
  { key: 'sqrt', label: <><sup>2</sup>√<i>x</i></>, aria: 'Square root', kind: 'fn' },
  { key: '÷',    label: '÷',  aria: 'Divide by',   kind: 'fn' },
  { key: '7', label: '7', aria: '7', kind: 'num' },
  { key: '8', label: '8', aria: '8', kind: 'num' },
  { key: '9', label: '9', aria: '9', kind: 'num' },
  { key: '×',    label: '×',  aria: 'Multiply by', kind: 'fn' },
  { key: '4', label: '4', aria: '4', kind: 'num' },
  { key: '5', label: '5', aria: '5', kind: 'num' },
  { key: '6', label: '6', aria: '6', kind: 'num' },
  { key: '−',    label: '−',  aria: 'Minus',       kind: 'fn' },
  { key: '1', label: '1', aria: '1', kind: 'num' },
  { key: '2', label: '2', aria: '2', kind: 'num' },
  { key: '3', label: '3', aria: '3', kind: 'num' },
  { key: '+',    label: '+',  aria: 'Plus',        kind: 'fn' },
  { key: 'neg',  label: '+/−', aria: 'Positive negative', kind: 'num' },
  { key: '0', label: '0', aria: '0', kind: 'num' },
  { key: '.',    label: '.',  aria: 'Decimal separator', kind: 'num' },
  { key: '=',    label: '=',  aria: 'Equals',      kind: 'eq' },
];

// Keyboard → key, matching the Windows calculator's shortcuts.
const KEYBOARD: Record<string, CalcKey> = {
  '0': '0', '1': '1', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
  '.': '.', ',': '.',  // the numpad decimal reads "," on some layouts
  '+': '+', '-': '−', '*': '×', 'x': '×', 'X': '×', '/': '÷',
  'Enter': '=', '=': '=', '%': '%',
  'Backspace': 'back', 'Delete': 'CE', 'Escape': 'C',
  'r': 'inv', 'R': 'inv', 'q': 'sqr', 'Q': 'sqr', '@': 'sqrt', 'F9': 'neg',
};

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

// bg-white/[…] steps rather than the glass tokens: globals.css re-tints
// exactly these for the light theme, so the keys read in both.
const keyCls = cn(
  'min-h-11 rounded-lg border border-[var(--glass-border)] select-none',
  'flex items-center justify-center font-mono tabular-nums text-lg',
  'transition-colors motion-reduce:transition-none',
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70',
);
const kindCls = {
  num: 'bg-white/[0.14] hover:bg-white/20 active:bg-white/[0.06] text-[var(--glass-ink)] font-semibold',
  fn:  'bg-white/[0.06] hover:bg-white/[0.14] active:bg-white/20 text-[var(--glass-ink)]',
  eq:  'bg-brand-primary hover:bg-brand-primary-hover border-transparent text-white font-semibold',
};
// A key pressed on the keyboard lights up its button, so the hand on the
// keys can see what the calculator heard.
const flashCls = 'ring-2 ring-inset ring-emerald-300/80';

const toolBtnCls = cn(
  'inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-medium',
  'text-[var(--glass-muted)] hover:text-[var(--glass-ink)] hover:bg-white/[0.06]',
  'disabled:opacity-40 disabled:pointer-events-none',
  'transition-colors motion-reduce:transition-none',
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70',
);

/** Display text steps down as the number grows, so 16 digits still fit. */
function sizeFor(text: string): string {
  if (text.length <= 10) return 'text-[2.25rem]';
  if (text.length <= 15) return 'text-[1.75rem]';
  return 'text-[1.375rem]';
}

export default function BasicCalculator({
  state, dispatch,
}: {
  state: CalcState;
  dispatch: React.Dispatch<CalcAction>;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [flash, setFlash] = useState<CalcKey | null>(null);
  const [copied, setCopied] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>();
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>();

  // Latest values for the window listeners, which are bound once.
  const live = useRef({ state, showHistory });
  live.current = { state, showHistory };

  const display = state.error ?? formatEntry(state.entry);
  // The line above: the pending sum plus a wrapped entry ("12 + √(9)").
  const line = `${state.expr}${state.error ? '' : state.entryExpr ?? ''}`;

  function copyResult() {
    const s = live.current.state;
    if (s.error) return;
    // The plain number, without grouping commas, so it pastes into any field.
    navigator.clipboard?.writeText(s.entry).then(() => {
      setCopied(true);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1500);
    }).catch(() => { /* clipboard refused — nothing to confirm */ });
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isEditable(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && (e.key === 'c' || e.key === 'C')) {
        // Leave a real text selection to the browser's own copy.
        if (window.getSelection()?.toString()) return;
        e.preventDefault();
        copyResult();
        return;
      }
      if (mod || e.altKey) return;

      const key = KEYBOARD[e.key];
      if (!key) return;
      if (key === 'C') {
        // Escape backs out a level at a time: history, then the sum, then
        // (left to the panel) the panel itself.
        if (live.current.showHistory) { e.preventDefault(); setShowHistory(false); return; }
        if (isBlank(live.current.state)) return;
      }
      // Enter on another button (Close, Copy, a history row) does that
      // button. Not on the tabs: focus sits on Basic straight after picking
      // it, and Enter there would only re-pick it — the sum wants the =.
      const t = e.target;
      if (e.key === 'Enter' && t instanceof HTMLButtonElement && !t.dataset.calcKey && t.getAttribute('role') !== 'tab') return;

      e.preventDefault();
      dispatch({ type: 'key', key });
      setFlash(key);
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), 140);
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isEditable(e.target)) return;
      const text = e.clipboardData?.getData('text');
      if (!text) return;
      e.preventDefault();
      dispatch({ type: 'paste', text });
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('paste', onPaste);
      clearTimeout(flashTimer.current);
      clearTimeout(copiedTimer.current);
    };
    // dispatch is stable; everything else is read through `live`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="-mx-1 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          aria-pressed={showHistory}
          className={cn(toolBtnCls, showHistory && 'bg-white/[0.06] text-[var(--glass-ink)]')}
        >
          <History className="h-4 w-4" aria-hidden="true" />
          History
          {state.history.length > 0 && <span className="font-mono tabular-nums">({state.history.length})</span>}
        </button>
        <button
          type="button"
          onClick={copyResult}
          disabled={state.error !== null}
          aria-label="Copy result"
          title="Copy result (Ctrl+C)"
          className={toolBtnCls}
        >
          {copied
            ? <><Check className="h-4 w-4 text-emerald-200" aria-hidden="true" />Copied</>
            : <Copy className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>

      {/* The display: the sum so far above, the number below. The line is
          end-aligned in a clipped flex row, so a long sum loses its start,
          not the part being worked on. */}
      <div className="mt-1 rounded-xl border border-[var(--field-border)] bg-[var(--field-bg)] px-3 py-2 text-right">
        <div className="flex h-5 justify-end overflow-hidden whitespace-nowrap font-mono tabular-nums text-xs text-[var(--glass-muted)]">
          <span className="shrink-0">{line}</span>
        </div>
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={cn(
            'truncate font-mono tabular-nums font-bold leading-tight',
            state.error ? 'py-2 text-xl text-red-300' : cn(sizeFor(display), 'text-[var(--glass-ink)]'),
          )}
        >
          <span className="sr-only">Display is </span>{display}
        </div>
      </div>

      {showHistory ? (
        <section aria-label="History" className="mt-3 flex flex-1 flex-col min-h-0">
          {state.history.length === 0 ? (
            <p className="m-auto max-w-[16rem] py-6 text-center text-sm text-[var(--glass-muted)]">
              No sums yet. Each one you finish with = is kept here until the page reloads.
            </p>
          ) : (
            <>
              <ul className="-mx-1 flex-1 space-y-0.5 overflow-y-auto">
                {state.history.map((h, i) => (
                  // Newest first and capped, so count-from-the-end keeps
                  // each row's key stable as new sums arrive.
                  <li key={state.history.length - i}>
                    <button
                      type="button"
                      onClick={() => { dispatch({ type: 'paste', text: h.result }); setShowHistory(false); }}
                      aria-label={`${h.expr} ${h.result}. Use this result`}
                      className={cn(
                        'w-full rounded-lg px-2 py-1.5 text-right font-mono tabular-nums',
                        'hover:bg-white/[0.06] transition-colors motion-reduce:transition-none',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70',
                      )}
                    >
                      <span className="block truncate text-xs text-[var(--glass-muted)]">{h.expr}</span>
                      <span className="block truncate text-lg font-semibold text-[var(--glass-ink)]">{h.result}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex justify-end pt-1">
                <button type="button" onClick={() => dispatch({ type: 'clearHistory' })} className={toolBtnCls}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Clear history
                </button>
              </div>
            </>
          )}
        </section>
      ) : (
        <div role="group" aria-label="Keypad" className="mt-3 grid flex-1 grid-cols-4 auto-rows-[minmax(2.75rem,1fr)] gap-1.5">
          {KEYPAD.map((k) => (
            <button
              key={k.key}
              type="button"
              data-calc-key={k.key}
              aria-label={k.aria}
              onClick={() => dispatch({ type: 'key', key: k.key })}
              className={cn(keyCls, kindCls[k.kind], flash === k.key && flashCls)}
            >
              {k.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
