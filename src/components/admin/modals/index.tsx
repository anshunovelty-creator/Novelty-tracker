'use client';
// src/components/admin/modals/index.tsx
// All six modals exported from one file.
// Each is a completely independent component — no shared state between them.

import React, { useState } from 'react';
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

// ── Shared modal wrapper ──────────────────────────────────────

function ModalBackdrop({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 modal-backdrop flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="modal-panel glass-strong glass shadow-2xl text-[var(--glass-ink)] w-full">
        {children}
      </div>
    </div>
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

  return (
    <ModalBackdrop>
      <div className="p-6">
        <div className="flex items-start gap-3 mb-4">
          <span className="text-2xl">⚠️</span>
          <div>
            <h3 className="font-semibold text-brand-accent text-base">
              Stage Not Yet Completed
            </h3>
            <p className="text-sm text-brand-muted mt-1">
              You&apos;re moving to <strong className="text-brand-accent">{targetStage}</strong>, but
              the previous stage <strong className="text-brand-accent">{missingStage}</strong> hasn&apos;t
              been marked complete yet.
            </p>
          </div>
        </div>

        {isAdmin ? (
          <>
            <label className="block text-xs font-medium text-brand-muted uppercase tracking-wide mb-1.5">
              Reason for skipping *
            </label>
            <textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              rows={2}
              placeholder="e.g. Stage was completed offline — updating system to match…"
              className={cn(inputCls, 'resize-none')}
            />
            <div className="flex gap-3 justify-end mt-4">
              <button
                onClick={onCancel}
                className="px-4 py-2 text-sm font-medium text-brand-muted hover:text-brand-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => remark.trim() && onOverride(remark.trim())}
                disabled={!remark.trim()}
                className="px-4 py-2 text-sm font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-40 transition-colors"
              >
                Skip &amp; Continue
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Stages must be completed in order. Complete{' '}
              <strong>{missingStage}</strong> first, or ask Admin to skip it.
            </p>
            <div className="flex justify-end mt-4">
              <button
                onClick={onCancel}
                className="px-4 py-2 text-sm font-medium bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 transition-colors"
              >
                OK
              </button>
            </div>
          </>
        )}
      </div>
    </ModalBackdrop>
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

  return (
    <ModalBackdrop>
      <div className="p-6">
        <h3 className="font-semibold text-brand-accent text-base mb-1">
          Place Order On Hold
        </h3>
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
          ⚠️ This reason will be visible to the client on the tracking portal.
        </p>

        <label className="block text-xs font-medium text-brand-muted uppercase tracking-wide mb-1.5">
          Halt Reason *
        </label>
        <textarea
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          rows={3}
          placeholder="e.g. Awaiting shade card approval from client…"
          className={cn(inputCls, 'resize-none')}
        />

        <div className="flex gap-3 justify-end mt-4">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-brand-muted hover:text-brand-accent transition-colors">
            Cancel
          </button>
          <button
            onClick={() => remark.trim() && onConfirm(remark.trim())}
            disabled={!remark.trim()}
            className="px-4 py-2 text-sm font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-40 transition-colors"
          >
            Mark On Hold
          </button>
        </div>
      </div>
    </ModalBackdrop>
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

  return (
    <ModalBackdrop>
      <div className="p-6">
        <h3 className="font-semibold text-brand-accent text-base mb-1">
          Quality Check
        </h3>
        <p className="text-xs text-sky-700 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2 mb-4">
          Leave blank for a clean pass. If filled, the remark will be visible to the client.
        </p>

        <label className="block text-xs font-medium text-brand-muted uppercase tracking-wide mb-1.5">
          QC Remark (optional)
        </label>
        <textarea
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          rows={3}
          placeholder="e.g. Minor colour variation within acceptable range…"
          className={cn(inputCls, 'resize-none')}
        />

        <div className="flex gap-3 justify-end mt-4">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-brand-muted hover:text-brand-accent transition-colors">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(remark.trim())}
            className="px-4 py-2 text-sm font-medium bg-sky-600 text-white rounded-lg hover:bg-sky-700 transition-colors"
          >
            Save QC
          </button>
        </div>
      </div>
    </ModalBackdrop>
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
  onConfirm: (qty: number) => void;
}) {
  const [qty, setQty] = useState<number | ''>('');

  const isValid = typeof qty === 'number' && qty > 0 && qty <= remaining;

  return (
    <ModalBackdrop>
      <div className="p-6">
        <h3 className="font-semibold text-brand-accent text-base mb-1">
          Partial Dispatch
        </h3>
        <p className="text-sm text-brand-muted mb-4">
          Remaining: <strong className="text-brand-accent font-mono">{formatQty(remaining)}</strong> labels
        </p>

        <label className="block text-xs font-medium text-brand-muted uppercase tracking-wide mb-1.5">
          Quantity to dispatch now *
        </label>
        <input
          type="number"
          min={1}
          max={remaining}
          value={qty}
          onChange={(e) => setQty(e.target.value ? Number(e.target.value) : '')}
          placeholder={`Max: ${remaining.toLocaleString('en-IN')}`}
          className={cn(inputCls, 'font-mono')}
        />
        {typeof qty === 'number' && qty > remaining && (
          <p className="text-xs text-red-600 mt-1">Cannot exceed remaining quantity.</p>
        )}

        <div className="flex gap-3 justify-end mt-4">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-brand-muted hover:text-brand-accent transition-colors">
            Cancel
          </button>
          {/* NOTE: Only ONE button — Save Partial Dispatch. No full dispatch button here. */}
          <button
            onClick={() => isValid && onConfirm(qty as number)}
            disabled={!isValid}
            className="px-4 py-2 text-sm font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-40 transition-colors"
          >
            Save Partial Dispatch
          </button>
        </div>
      </div>
    </ModalBackdrop>
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
  onConfirm: () => void;
}) {
  return (
    <ModalBackdrop>
      <div className="p-6">
        <h3 className="font-semibold text-brand-accent text-base mb-1">
          Confirm Full Dispatch
        </h3>
        <p className="text-sm text-brand-muted mb-6">
          Mark all remaining{' '}
          <strong className="text-brand-accent font-mono">{formatQty(remaining)}</strong>{' '}
          labels as fully dispatched?
        </p>

        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-brand-muted hover:text-brand-accent transition-colors">
            Cancel
          </button>
          {/* NOTE: Only ONE button — Confirm Full Dispatch. No partial input here. */}
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            Confirm Full Dispatch
          </button>
        </div>
      </div>
    </ModalBackdrop>
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
    <ModalBackdrop>
      <div className="p-6">
        <h3 className="font-semibold text-brand-accent text-base mb-1">
          Printing Complete — Record This Run
        </h3>
        <p className="text-sm text-brand-muted mb-4">
          Order total: <strong className="text-brand-accent font-mono">{formatQty(totalQty)}</strong>
          {alreadyDispatched > 0 && (
            <> · Already dispatched: <strong className="text-green-700 font-mono">{formatQty(alreadyDispatched)}</strong></>
          )}
        </p>

        <label className="block text-xs font-medium text-brand-muted uppercase tracking-wide mb-1.5">
          How many labels printed in this run? *
        </label>
        <input
          type="number"
          min={1}
          max={remainingBefore}
          value={qty}
          onChange={(e) => setQty(e.target.value ? Number(e.target.value) : '')}
          placeholder={`Max: ${remainingBefore.toLocaleString('en-IN')}`}
          className={cn(inputCls, 'font-mono')}
        />
        {qtyNum > remainingBefore && (
          <p className="text-xs text-red-600 mt-1">Cannot exceed remaining quantity.</p>
        )}

        {/* Auto-calculated remaining */}
        <div className="mt-3 bg-brand-bg rounded-lg px-3 py-2 flex justify-between text-sm font-mono">
          <span className="text-brand-muted">Remaining after this run</span>
          <span className={remainingAfter > 0 ? 'text-amber-700' : 'text-green-700'}>
            {qtyValid ? formatQty(remainingAfter) : '—'}
          </span>
        </div>

        <label className="block text-xs font-medium text-brand-muted uppercase tracking-wide mb-1.5 mt-4">
          Notes (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="e.g. Client requested early partial delivery…"
          className={cn(inputCls, 'resize-none')}
        />

        <div className="flex flex-col sm:flex-row gap-2 justify-end mt-5">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-brand-muted hover:text-brand-accent transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => isPartial && confirm(true)}
            disabled={!isPartial}
            title={!isPartial && qtyValid ? 'Quantity equals the full remaining order' : undefined}
            className={cn(
              'px-4 py-2 text-sm font-medium rounded-lg transition-colors',
              'bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40'
            )}
          >
            More labels to be printed later
          </button>
          <button
            onClick={() => isFullQty && confirm(false)}
            disabled={!isFullQty}
            title={!isFullQty && qtyValid ? 'Enter the full remaining quantity to complete the order' : undefined}
            className={cn(
              'px-4 py-2 text-sm font-medium rounded-lg transition-colors',
              'bg-green-600 text-white hover:bg-green-700 disabled:opacity-40'
            )}
          >
            This completes the full order
          </button>
        </div>
      </div>
    </ModalBackdrop>
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
  return (
    <ModalBackdrop>
      <div className="p-6">
        <h3 className="font-semibold text-brand-accent text-base mb-4">
          Close PO &amp; Archive
        </h3>

        {/* Job summary */}
        <div className="bg-brand-bg rounded-lg p-4 space-y-2 mb-4 font-mono text-sm">
          <div className="flex justify-between">
            <span className="text-brand-muted">Total Ordered</span>
            <span className="text-brand-accent">{formatQty(job.label_qty)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-brand-muted">Dispatched</span>
            <span className="text-green-700">{formatQty(job.dispatched_qty)}</span>
          </div>
          <div className="flex justify-between border-t border-brand-border pt-2">
            <span className="text-brand-muted">Remaining</span>
            <span className={job.remaining_qty ? 'text-amber-700' : 'text-green-700'}>
              {formatQty(job.remaining_qty ?? 0)}
            </span>
          </div>
        </div>

        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
          This job will be archived. Clients can still track it by PO number. This action cannot be undone from the UI.
        </p>

        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-brand-muted hover:text-brand-accent transition-colors">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 transition-colors"
          >
            Close PO &amp; Archive
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
