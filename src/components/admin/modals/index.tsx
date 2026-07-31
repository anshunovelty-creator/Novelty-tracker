'use client';
// src/components/admin/modals/index.tsx
// All stage modals + shared modal infrastructure, exported from one file.
// Each stage modal is an independent component — no shared state between them.
// ModalShell provides the a11y shell (role=dialog, focus trap, Escape, focus
// return, scroll lock) so every modal in the admin panel behaves consistently.

import React, { useState, useEffect, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';
import { cn, formatQty } from '@/lib/utils';
import type { Stage } from '@/lib/constants/stages';
import type { Job } from '@/lib/types';

// Shared glass input style for all modal text fields
const inputCls = cn(
  'w-full px-3.5 py-2.5 rounded-xl text-sm bg-[var(--glass-bg)] border border-[var(--glass-border)]',
  'text-[var(--glass-ink)] placeholder:text-[var(--glass-muted)] backdrop-blur-md',
  'focus:outline-none focus:border-emerald-300/70 focus:bg-white/[0.14]',
  'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
);

// Shared button styles — on-brand, all AA-legible on the dark glass panel
const btnCancel  = 'px-4 py-2 text-sm font-medium text-[var(--glass-muted)] hover:text-[var(--glass-ink)] transition-colors';
const btnPrimary = 'px-4 py-2 text-sm font-medium rounded-lg bg-brand-primary text-white hover:bg-brand-primary/90 disabled:opacity-40 transition-colors';
const btnCaution = 'px-4 py-2 text-sm font-medium rounded-lg bg-amber-400/20 border border-amber-300/30 text-amber-100 hover:bg-amber-400/30 disabled:opacity-40 transition-colors';
const btnDanger  = 'px-4 py-2 text-sm font-medium rounded-lg bg-red-400/20 border border-red-300/30 text-red-200 hover:bg-red-400/30 disabled:opacity-40 transition-colors';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// ── Shared modal shell ────────────────────────────────────────
// role=dialog + aria-modal, initial focus, focus trap, Escape to close,
// focus return to the trigger, and body scroll lock. Backdrop click = cancel.

export function ModalShell({
  titleId,
  onClose,
  children,
}: {
  titleId?: string;
  onClose?: () => void;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;

    const focusables = () =>
      panel
        ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
            (el) => el.offsetParent !== null,
          )
        : [];

    (focusables()[0] ?? panel)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        panel?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  // Rendered via a portal to <body> so the dialog never sits inside a
  // <table>/<tbody> (a modal opened from a JobRow <tr> would otherwise put a
  // <div> inside <tbody> — invalid HTML → hydration error). The `admin-light`
  // wrapper re-establishes the light-theme scope outside the admin shell;
  // `contents` means the wrapper paints no box of its own.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="admin-light contents">
      <div
        className="fixed inset-0 z-50 modal-backdrop flex items-end sm:items-center justify-center p-0 sm:p-4"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose?.();
        }}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="modal-panel glass-strong glass shadow-2xl text-[var(--glass-ink)] w-full focus:outline-none"
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Generic confirm dialog ────────────────────────────────────
// Replaces window.confirm for destructive/important actions.

export function ConfirmModal({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  busy = false,
  onCancel,
  onConfirm,
}: {
  title: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  return (
    <ModalShell titleId={titleId} onClose={onCancel}>
      <div className="p-6">
        <h3 id={titleId} className="font-semibold text-[var(--glass-ink)] text-base mb-1">
          {title}
        </h3>
        {message && <p className="text-sm text-[var(--glass-muted)] mb-5">{message}</p>}
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className={btnCancel}>
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={tone === 'danger' ? btnDanger : btnPrimary}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ── Generic prompt dialog ─────────────────────────────────────
// Replaces window.prompt. Supports optional text, required text, textarea,
// and positive-number input with inline validation.

export function PromptModal({
  title,
  description,
  label,
  kind = 'text',
  required = false,
  min,
  initialValue = '',
  confirmLabel = 'Save',
  placeholder,
  onCancel,
  onConfirm,
}: {
  title: string;
  description?: React.ReactNode;
  label: string;
  kind?: 'text' | 'textarea' | 'number';
  required?: boolean;
  min?: number;
  initialValue?: string;
  confirmLabel?: string;
  placeholder?: string;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const titleId = useId();
  const fieldId = useId();

  const trimmed = value.trim();
  const numeric = Number(trimmed);
  const numberBad =
    kind === 'number' &&
    (trimmed === '' || Number.isNaN(numeric) || numeric <= 0 || (min != null && numeric < min));
  const invalid = (required && trimmed === '') || (kind === 'number' && (required ? numberBad : trimmed !== '' && numberBad));

  function submit() {
    if (invalid) return;
    onConfirm(trimmed);
  }

  return (
    <ModalShell titleId={titleId} onClose={onCancel}>
      <div className="p-6">
        <h3 id={titleId} className="font-semibold text-[var(--glass-ink)] text-base mb-1">
          {title}
        </h3>
        {description && <p className="text-sm text-[var(--glass-muted)] mb-4">{description}</p>}

        <label htmlFor={fieldId} className="block text-xs font-medium text-[var(--glass-muted)] uppercase tracking-wide mb-1.5">
          {label}
        </label>
        {kind === 'textarea' ? (
          <textarea
            id={fieldId}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={3}
            placeholder={placeholder}
            className={cn(inputCls, 'resize-none')}
          />
        ) : (
          <input
            id={fieldId}
            type={kind === 'number' ? 'number' : 'text'}
            inputMode={kind === 'number' ? 'numeric' : undefined}
            min={kind === 'number' ? min ?? 1 : undefined}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
            placeholder={placeholder}
            className={cn(inputCls, kind === 'number' && 'font-mono')}
          />
        )}
        {kind === 'number' && trimmed !== '' && numberBad && (
          <p className="text-xs text-red-300 mt-1">Enter a quantity of {min ?? 1} or more.</p>
        )}

        <div className="flex gap-3 justify-end mt-4">
          <button onClick={onCancel} className={btnCancel}>
            Cancel
          </button>
          <button onClick={submit} disabled={invalid} className={btnPrimary}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ── 1. Sequential Warning Modal ───────────────────────────────
// Non-admin: hard block — sequential order is enforced.
// Admin: may skip, but must give a justification remark (saved as an
// internal stage comment for the audit trail).

export function SequentialWarningModal({
  targetStage,
  missingStage,
  isAdmin,
  onCancel,
  onOverride,
}: {
  targetStage:  Stage;
  missingStage: Stage;
  isAdmin:      boolean;
  onCancel:     () => void;
  onOverride:   (overrideRemark: string) => void;
}) {
  const [remark, setRemark] = useState('');
  const titleId = useId();
  const reasonId = useId();

  return (
    <ModalShell titleId={titleId} onClose={onCancel}>
      <div className="p-6">
        <div className="flex items-start gap-3 mb-4">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-200" aria-hidden="true" />
          <div>
            <h3 id={titleId} className="font-semibold text-[var(--glass-ink)] text-base">
              Stage Not Yet Completed
            </h3>
            <p className="text-sm text-[var(--glass-muted)] mt-1">
              You&apos;re moving to <strong className="text-[var(--glass-ink)]">{targetStage}</strong>, but
              the previous stage <strong className="text-[var(--glass-ink)]">{missingStage}</strong> hasn&apos;t
              been marked complete yet.
            </p>
          </div>
        </div>

        {isAdmin ? (
          <>
            <label htmlFor={reasonId} className="block text-xs font-medium text-[var(--glass-muted)] uppercase tracking-wide mb-1.5">
              Reason for skipping *
            </label>
            <textarea
              id={reasonId}
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              rows={2}
              placeholder="e.g. Stage was completed offline — updating system to match…"
              className={cn(inputCls, 'resize-none')}
            />
            <div className="flex gap-3 justify-end mt-4">
              <button onClick={onCancel} className={btnCancel}>
                Cancel
              </button>
              <button
                onClick={() => remark.trim() && onOverride(remark.trim())}
                disabled={!remark.trim()}
                className={btnCaution}
              >
                Skip &amp; Continue
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-amber-200 bg-amber-400/10 border border-amber-300/25 rounded-lg px-3 py-2">
              Stages must be completed in order. Complete{' '}
              <strong>{missingStage}</strong> first, or ask Admin to skip it.
            </p>
            <div className="flex justify-end mt-4">
              <button onClick={onCancel} className={btnPrimary}>
                OK
              </button>
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
}

// ── 2. On Hold Modal ──────────────────────────────────────────

export function OnHoldModal({
  onCancel,
  onConfirm,
}: {
  onCancel:  () => void;
  onConfirm: (remark: string) => void;
}) {
  const [remark, setRemark] = useState('');
  const titleId = useId();
  const reasonId = useId();

  return (
    <ModalShell titleId={titleId} onClose={onCancel}>
      <div className="p-6">
        <h3 id={titleId} className="font-semibold text-[var(--glass-ink)] text-base mb-1">
          Place Order On Hold
        </h3>
        <p className="text-xs text-amber-200 bg-amber-400/10 border border-amber-300/25 rounded-lg px-3 py-2 mb-4">
          This reason will be visible to the client on the tracking portal.
        </p>

        <label htmlFor={reasonId} className="block text-xs font-medium text-[var(--glass-muted)] uppercase tracking-wide mb-1.5">
          Halt Reason *
        </label>
        <textarea
          id={reasonId}
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          rows={3}
          placeholder="e.g. Awaiting shade card approval from client…"
          className={cn(inputCls, 'resize-none')}
        />

        <div className="flex gap-3 justify-end mt-4">
          <button onClick={onCancel} className={btnCancel}>
            Cancel
          </button>
          <button
            onClick={() => remark.trim() && onConfirm(remark.trim())}
            disabled={!remark.trim()}
            className={btnCaution}
          >
            Mark On Hold
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ── 3. QC Modal ───────────────────────────────────────────────

export function QCModal({
  onCancel,
  onConfirm,
}: {
  onCancel:  () => void;
  onConfirm: (remark: string) => void;
}) {
  const [remark, setRemark] = useState('');
  const titleId = useId();
  const remarkId = useId();

  return (
    <ModalShell titleId={titleId} onClose={onCancel}>
      <div className="p-6">
        <h3 id={titleId} className="font-semibold text-[var(--glass-ink)] text-base mb-1">
          Quality Check
        </h3>
        <p className="text-xs text-sky-200 bg-sky-400/10 border border-sky-300/25 rounded-lg px-3 py-2 mb-4">
          Leave blank for a clean pass. If filled, the remark will be visible to the client.
        </p>

        <label htmlFor={remarkId} className="block text-xs font-medium text-[var(--glass-muted)] uppercase tracking-wide mb-1.5">
          QC Remark (optional)
        </label>
        <textarea
          id={remarkId}
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          rows={3}
          placeholder="e.g. Minor colour variation within acceptable range…"
          className={cn(inputCls, 'resize-none')}
        />

        <div className="flex gap-3 justify-end mt-4">
          <button onClick={onCancel} className={btnCancel}>
            Cancel
          </button>
          <button onClick={() => onConfirm(remark.trim())} className={btnPrimary}>
            Save QC
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ── 4. Partial Dispatch Modal ─────────────────────────────────
// COMPLETELY SEPARATE from Full Dispatch — different trigger, different modal, different button.

export function PartialDispatchModal({
  remaining,
  onCancel,
  onConfirm,
}: {
  remaining: number;
  onCancel:  () => void;
  onConfirm: (qty: number, stockRemaining: number) => void;
}) {
  const [qty, setQty] = useState<number | ''>('');
  const titleId = useId();
  const qtyId = useId();
  const stockId = useId();

  const isValid = typeof qty === 'number' && qty > 0 && qty <= remaining;

  // What is physically left on the shelf after this dispatch. Pre-filled from
  // the order balance, but editable: the press may have run short, so the
  // arithmetic answer is a starting point, not the truth.
  const computedLeft = isValid ? remaining - (qty as number) : remaining;
  const [stockLeft, setStockLeft] = useState<number | ''>('');
  const effectiveStockLeft = stockLeft === '' ? computedLeft : stockLeft;

  return (
    <ModalShell titleId={titleId} onClose={onCancel}>
      <div className="p-6">
        <h3 id={titleId} className="font-semibold text-[var(--glass-ink)] text-base mb-1">
          Partial Dispatch
        </h3>
        <p className="text-sm text-[var(--glass-muted)] mb-4">
          Remaining: <strong className="text-[var(--glass-ink)] font-mono">{formatQty(remaining)}</strong> labels
        </p>

        <label htmlFor={qtyId} className="block text-xs font-medium text-[var(--glass-muted)] uppercase tracking-wide mb-1.5">
          Quantity to dispatch now *
        </label>
        <input
          id={qtyId}
          type="number"
          inputMode="numeric"
          min={1}
          max={remaining}
          value={qty}
          onChange={(e) => setQty(e.target.value ? Number(e.target.value) : '')}
          placeholder={`Max: ${remaining.toLocaleString('en-IN')}`}
          className={cn(inputCls, 'font-mono')}
        />
        {typeof qty === 'number' && qty > remaining && (
          <p className="text-xs text-red-300 mt-1">Cannot exceed remaining quantity.</p>
        )}

        {/* The balance stays on the shelf — record it so it can be found later */}
        <label htmlFor={stockId} className="block text-xs font-medium text-[var(--glass-muted)] uppercase tracking-wide mt-4 mb-1.5">
          Labels left in stock
        </label>
        <input
          id={stockId}
          type="number"
          inputMode="numeric"
          min={0}
          value={stockLeft}
          onChange={(e) => setStockLeft(e.target.value ? Number(e.target.value) : '')}
          placeholder={formatQty(computedLeft)}
          className={cn(inputCls, 'font-mono')}
        />
        <p className="text-xs text-[var(--glass-muted)] mt-1.5">
          Defaults to{' '}
          <strong className="text-[var(--glass-ink)] font-mono">{formatQty(computedLeft)}</strong>
          {' '}— the order balance. Correct it if the shelf says otherwise.
          {' '}This goes to Label Stock.
        </p>

        <div className="flex gap-3 justify-end mt-4">
          <button onClick={onCancel} className={btnCancel}>
            Cancel
          </button>
          {/* NOTE: Only ONE button — Save Partial Dispatch. No full dispatch button here. */}
          <button
            onClick={() => isValid && onConfirm(qty as number, effectiveStockLeft as number)}
            disabled={!isValid}
            className={btnCaution}
          >
            Save Partial Dispatch
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ── 5. Full Dispatch Modal ────────────────────────────────────
// COMPLETELY SEPARATE from Partial Dispatch. No qty input. No partial button.

export function FullDispatchModal({
  remaining,
  onCancel,
  onConfirm,
}: {
  remaining: number;
  onCancel:  () => void;
  onConfirm: (extraQty: number, location: string, remark: string) => void;
}) {
  const titleId  = useId();
  const extraId  = useId();
  const locId    = useId();
  const remarkId = useId();

  // Surplus printed beyond the order. Blank means none — the question is asked
  // every time, but answering it is never a tax on the common case.
  const [extraQty, setExtraQty] = useState<number | ''>('');
  const [location, setLocation] = useState('');
  const [remark,   setRemark]   = useState('');

  const hasExtra = typeof extraQty === 'number' && extraQty > 0;

  return (
    <ModalShell titleId={titleId} onClose={onCancel}>
      <div className="p-6">
        <h3 id={titleId} className="font-semibold text-[var(--glass-ink)] text-base mb-1">
          Confirm Full Dispatch
        </h3>
        <p className="text-sm text-[var(--glass-muted)] mb-5">
          Mark all remaining{' '}
          <strong className="text-[var(--glass-ink)] font-mono">{formatQty(remaining)}</strong>{' '}
          labels as fully dispatched? Anything held in stock for this job clears out.
        </p>

        {/* Over-runs are found now or never — once the job closes, nobody
            remembers why a pile of labels is on the shelf. */}
        <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4">
          <label htmlFor={extraId} className="block text-xs font-medium text-[var(--glass-muted)] uppercase tracking-wide mb-1.5">
            Any extra labels printed?
          </label>
          <input
            id={extraId}
            type="number"
            inputMode="numeric"
            min={0}
            value={extraQty}
            onChange={(e) => setExtraQty(e.target.value ? Number(e.target.value) : '')}
            placeholder="Leave blank if none"
            className={cn(inputCls, 'font-mono')}
          />

          {hasExtra && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <div>
                <label htmlFor={locId} className="block text-xs font-medium text-[var(--glass-muted)] uppercase tracking-wide mb-1.5">
                  Location
                </label>
                <input
                  id={locId}
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Rack / shelf"
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor={remarkId} className="block text-xs font-medium text-[var(--glass-muted)] uppercase tracking-wide mb-1.5">
                  Remark
                </label>
                <input
                  id={remarkId}
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                  placeholder="Optional"
                  className={inputCls}
                />
              </div>
            </div>
          )}

          <p className="text-xs text-[var(--glass-muted)] mt-2">
            {hasExtra
              ? `${formatQty(extraQty as number)} labels will be added to Label Stock.`
              : 'Blank or 0 adds nothing to stock.'}
          </p>
        </div>

        <div className="flex gap-3 justify-end mt-5">
          <button onClick={onCancel} className={btnCancel}>
            Cancel
          </button>
          {/* NOTE: Only ONE button — Confirm Full Dispatch. No partial input here. */}
          <button
            onClick={() => onConfirm(hasExtra ? (extraQty as number) : 0, location, remark)}
            className={btnPrimary}
          >
            Confirm Full Dispatch
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ── 7. Print Run Modal ────────────────────────────────────────
// Shown when Production completes printing. Captures how many labels
// were printed this cycle and whether more cycles will follow.
// The two action buttons are mutually exclusive by quantity:
//   "This completes the full order"  → enabled only when qty == remaining
//   "More labels to be printed later" → enabled only when qty < remaining

export function PrintRunModal({
  totalQty,
  alreadyDispatched,
  onCancel,
  onConfirm,
}: {
  totalQty:          number;   // job.label_qty
  alreadyDispatched: number;   // job.total_qty_dispatched
  onCancel:          () => void;
  onConfirm:         (payload: {
    qty_this_run:        number;
    qty_remaining_after: number;
    more_runs:           boolean;
    notes:               string;
  }) => void;
}) {
  const [qty,   setQty]   = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const titleId = useId();
  const qtyId = useId();
  const notesId = useId();

  const remainingBefore = totalQty - alreadyDispatched;
  const qtyNum          = typeof qty === 'number' ? qty : 0;
  const remainingAfter  = Math.max(remainingBefore - qtyNum, 0);

  const qtyValid    = qtyNum > 0 && qtyNum <= remainingBefore;
  const isFullQty   = qtyValid && qtyNum === remainingBefore;
  const isPartial   = qtyValid && qtyNum <  remainingBefore;

  function confirm(moreRuns: boolean) {
    onConfirm({
      qty_this_run:        qtyNum,
      qty_remaining_after: moreRuns ? remainingAfter : 0,
      more_runs:           moreRuns,
      notes:               notes.trim(),
    });
  }

  return (
    <ModalShell titleId={titleId} onClose={onCancel}>
      <div className="p-6">
        <h3 id={titleId} className="font-semibold text-[var(--glass-ink)] text-base mb-1">
          Printing Complete — Record This Run
        </h3>
        <p className="text-sm text-[var(--glass-muted)] mb-4">
          Order total: <strong className="text-[var(--glass-ink)] font-mono">{formatQty(totalQty)}</strong>
          {alreadyDispatched > 0 && (
            <> · Already dispatched: <strong className="text-emerald-200 font-mono">{formatQty(alreadyDispatched)}</strong></>
          )}
        </p>

        <label htmlFor={qtyId} className="block text-xs font-medium text-[var(--glass-muted)] uppercase tracking-wide mb-1.5">
          How many labels printed in this run? *
        </label>
        <input
          id={qtyId}
          type="number"
          inputMode="numeric"
          min={1}
          max={remainingBefore}
          value={qty}
          onChange={(e) => setQty(e.target.value ? Number(e.target.value) : '')}
          placeholder={`Max: ${remainingBefore.toLocaleString('en-IN')}`}
          className={cn(inputCls, 'font-mono')}
        />
        {qtyNum > remainingBefore && (
          <p className="text-xs text-red-300 mt-1">Cannot exceed remaining quantity.</p>
        )}

        {/* Auto-calculated remaining */}
        <div className="mt-3 bg-white/[0.06] border border-white/10 rounded-lg px-3 py-2 flex justify-between text-sm font-mono">
          <span className="text-[var(--glass-muted)]">Remaining after this run</span>
          <span className={remainingAfter > 0 ? 'text-amber-200' : 'text-emerald-200'}>
            {qtyValid ? formatQty(remainingAfter) : '—'}
          </span>
        </div>

        <label htmlFor={notesId} className="block text-xs font-medium text-[var(--glass-muted)] uppercase tracking-wide mb-1.5 mt-4">
          Notes (optional)
        </label>
        <textarea
          id={notesId}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="e.g. Client requested early partial delivery…"
          className={cn(inputCls, 'resize-none')}
        />

        <div className="flex flex-col sm:flex-row gap-2 justify-end mt-5">
          <button onClick={onCancel} className={btnCancel}>
            Cancel
          </button>
          <button
            onClick={() => isPartial && confirm(true)}
            disabled={!isPartial}
            title={!isPartial && qtyValid ? 'Quantity equals the full remaining order' : undefined}
            className={btnCaution}
          >
            More labels to be printed later
          </button>
          <button
            onClick={() => isFullQty && confirm(false)}
            disabled={!isFullQty}
            title={!isFullQty && qtyValid ? 'Enter the full remaining quantity to complete the order' : undefined}
            className={btnPrimary}
          >
            This completes the full order
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ── 6. Close PO Modal ─────────────────────────────────────────

export function ClosePOModal({
  job,
  onCancel,
  onConfirm,
}: {
  job:       Job;
  onCancel:  () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  return (
    <ModalShell titleId={titleId} onClose={onCancel}>
      <div className="p-6">
        <h3 id={titleId} className="font-semibold text-[var(--glass-ink)] text-base mb-4">
          Close PO &amp; Archive
        </h3>

        {/* Job summary */}
        <div className="bg-white/[0.06] border border-white/10 rounded-lg p-4 space-y-2 mb-4 font-mono text-sm">
          <div className="flex justify-between">
            <span className="text-[var(--glass-muted)]">Total Ordered</span>
            <span className="text-[var(--glass-ink)]">{formatQty(job.label_qty)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--glass-muted)]">Dispatched</span>
            <span className="text-emerald-200">{formatQty(job.dispatched_qty)}</span>
          </div>
          <div className="flex justify-between border-t border-white/10 pt-2">
            <span className="text-[var(--glass-muted)]">Remaining</span>
            <span className={job.remaining_qty ? 'text-amber-200' : 'text-emerald-200'}>
              {formatQty(job.remaining_qty ?? 0)}
            </span>
          </div>
        </div>

        <p className="text-xs text-amber-200 bg-amber-400/10 border border-amber-300/25 rounded-lg px-3 py-2 mb-4">
          This job will be archived. Clients can still track it by PO number. This action cannot be undone from the UI.
        </p>

        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className={btnCancel}>
            Cancel
          </button>
          <button onClick={onConfirm} className={btnPrimary}>
            Close PO &amp; Archive
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
