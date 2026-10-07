'use client';
// src/components/admin/modals/index.tsx
// All stage modals + shared modal infrastructure, exported from one file.
// Each stage modal is an independent component — no shared state between them.
// ModalShell provides the a11y shell (role=dialog, focus trap, Escape, focus
// return, scroll lock) so every modal in the admin panel behaves consistently.

import React, { useState, useEffect, useRef, useId, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { cn, formatJobCardNumber, formatQty } from '@/lib/utils';
import { deliveryWords, istToday } from '@/lib/jobViews';
import { STAGE_DOT } from '@/lib/constants/statusColors';
import { StateChip } from '@/components/ui/StateChip';
import {
  HOLD_REASONS, QC_RESULTS, holdRemark, qcRemark,
  type HoldReason, type QCResult, type PartialDispatchInput, type FullDispatchInput,
} from '@/lib/stageDialogs';

export { partialDispatchPayload, fullDispatchPayload } from '@/lib/stageDialogs';
import { buttonClass } from '@/components/ui/Button';
import { WithExample, WithUnit } from '@/components/ui/FieldAffix';
import { PIPELINE_STAGES, stageIndex, type Stage } from '@/lib/constants/stages';
import type { Job } from '@/lib/types';

// Shared glass input style for all modal text fields
const inputCls = cn(
  'w-full px-3.5 py-2.5 rounded-xl text-sm bg-[var(--field-bg)] border border-[var(--field-border)]',
  'text-[var(--glass-ink)] placeholder:text-[var(--glass-muted)] backdrop-blur-md',
  'focus:outline-none focus:border-emerald-300/70 focus:bg-white/[0.14]',
  'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
);

// Shared button styles — on-brand, all AA-legible on the dark glass panel
// Modal footer buttons now draw from the shared Button vocabulary
// (components/ui/Button). These aliases keep the ~22 call sites below reading
// as they did, while sizing, radius, focus and disabled stop being redefined
// per dialog.
//
// btnCaution stays amber deliberately: every action wearing it — Mark On
// Hold, Save Partial Dispatch, Skip & Continue, "More labels to be printed
// later" — moves the job into an amber-coded state, so the colour is state,
// not decoration. See the State-Only Spectrum note in Button.tsx.
const btnCancel  = buttonClass('ghost');
const btnPrimary = buttonClass('primary');
const btnCaution = buttonClass('caution');
const btnDanger  = buttonClass('danger');

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

  // `onClose` is an inline arrow at nearly every call site, so it carries a
  // fresh identity on every parent render. Holding it in a ref lets the
  // effects below depend on nothing that changes — see the focus note.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  const focusables = useCallback(() => {
    const panel = panelRef.current;
    return panel
      ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => el.offsetParent !== null,
        )
      : [];
  }, []);

  // Focus on open, and restore it on close. Mount-only, deliberately.
  //
  // This effect used to depend on [onClose]. Since that prop is an inline
  // arrow, ANY parent re-render tore the effect down and re-ran it — including
  // the initial focus call — which pulled the caret out of whatever field was
  // being typed into and dropped it on the first focusable element, the
  // header's close button. JobSeparationManager polls every 30s (POLL_MS), so
  // a half-filled form lost focus every thirty seconds; React Query's
  // refetchOnWindowFocus did the same on tab-switch, for all 15 dialogs built
  // on this shell. Focusing on open must happen once and never again.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Prefer the first real field over the first focusable. Focus has to land
    // inside the dialog — otherwise keyboard and screen-reader users are left
    // on the page underneath and the Tab trap has nothing to hold — but the
    // first focusable is the header's close button, which is the one control
    // that discards the work. On a form, start in the form. Dialogs with no
    // fields (ConfirmModal) fall through to their first button as before.
    const items = focusables();
    const firstField = items.find((el) =>
      /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && !(el as HTMLInputElement).readOnly,
    );
    (firstField ?? items[0] ?? panelRef.current)?.focus();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [focusables]);

  // Escape closes; Tab cycles within the panel.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        panelRef.current?.focus();
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
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [focusables]);

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
  example,
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
  /** Shown under the field while it has focus — never inside it. */
  example?: string;
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
        <WithExample example={example}>
          {kind === 'textarea' ? (
            <textarea
              id={fieldId}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              rows={3}
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
              className={cn(inputCls, kind === 'number' && 'font-mono')}
            />
          )}
        </WithExample>
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

// ── Stage dialogs, Control Room grammar ───────────────────────
// Every dialog that moves a job reads the same way: a caption naming the
// stage and who sets it, the job card in the title, the numbers that matter
// in a facts row, the one or two answers needed, then a plain sentence saying
// what will happen. White body, soft footer, 44px controls.

const dBtn = 'inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const dPrimary = cn(dBtn, 'border-transparent bg-brand-primary text-white hover:bg-brand-primary-hover');
const dQuiet   = cn(dBtn, 'border-transparent bg-transparent font-medium text-brand-muted hover:bg-brand-surface-hover hover:text-brand-ink');
const dHold    = cn(dBtn, 'border-[#D97706] bg-[#FFFBEB] text-[#92400E] hover:bg-[#FEF3C7]');
const dDanger  = cn(dBtn, 'border-transparent bg-[#B91C1C] text-white hover:bg-[#991B1B]');

const dField = cn(
  'w-full min-h-11 rounded-[10px] border border-brand-border bg-white px-3 text-[15px] text-brand-ink',
  'placeholder:text-brand-faint focus:border-brand-primary focus:outline-none focus:shadow-[0_0_0_4px_rgba(16,85,63,0.18)]',
);
const dArea = cn(dField, 'resize-none py-2.5 text-sm leading-relaxed');

/** "OCT26-14", or the PO number for a job without a card. */
function jobRef(job?: Job | null): string | null {
  if (!job) return null;
  return formatJobCardNumber(job.job_card_number) ?? job.po_number;
}

function Ref({ job }: { job?: Job | null }) {
  const ref = jobRef(job);
  return ref ? <span className="font-mono">{ref}</span> : <>this job</>;
}

function StageDialog({
  titleId, cap, title, sub, onClose, children, footer,
}: {
  titleId: string;
  cap:     string;
  title:   React.ReactNode;
  sub?:    React.ReactNode;
  onClose: () => void;
  children?: React.ReactNode;
  footer:  React.ReactNode;
}) {
  return (
    <ModalShell titleId={titleId} onClose={onClose}>
      <div className="flex flex-col text-brand-ink">
        <div className="flex flex-col gap-1 border-b border-brand-line-soft bg-white px-6 py-5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-brand-muted">{cap}</span>
          <h2 id={titleId} className="text-lg font-semibold leading-snug">{title}</h2>
          {sub && <p className="text-[13px] leading-relaxed text-brand-muted">{sub}</p>}
        </div>
        {children && <div className="flex flex-col gap-4 bg-white px-6 py-5">{children}</div>}
        <div className="flex flex-wrap justify-end gap-2 border-t border-brand-line-soft px-6 py-3.5">{footer}</div>
      </div>
    </ModalShell>
  );
}

function Facts({ items }: { items: [string, React.ReactNode, ('bad' | undefined)?][] }) {
  return (
    <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-brand-line-soft bg-brand-line-soft">
      {items.map(([k, v, tone]) => (
        <div key={k} className="flex min-w-0 flex-col gap-0.5 bg-white px-3 py-2.5">
          <dt className="text-xs text-brand-muted">{k}</dt>
          <dd className={cn('truncate font-mono text-base font-semibold', tone === 'bad' && 'text-brand-danger')}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Note({ tone, children }: { tone: 'ok' | 'warn' | 'bad'; children: React.ReactNode }) {
  return (
    <p
      role={tone === 'ok' ? undefined : 'note'}
      className={cn(
        'rounded-xl px-3.5 py-3 text-[13px] leading-relaxed',
        tone === 'ok' && 'bg-[#ECFDF5] text-[#065F46]',
        tone === 'warn' && 'bg-[#FFFBEB] text-[#92400E]',
        tone === 'bad' && 'bg-[#FEF2F2] text-[#B91C1C]',
      )}
    >
      {children}
    </p>
  );
}

function Move({ from, to }: { from: Stage; to: Stage }) {
  return (
    <p className="flex flex-wrap items-center gap-2.5 text-[13px]">
      <StateChip label={from} dot={STAGE_DOT[from]} />
      <span aria-hidden="true" className="text-brand-muted">→</span>
      <span className="sr-only">to</span>
      <StateChip label={to} dot={STAGE_DOT[to]} />
    </p>
  );
}

function Field({ label, htmlFor, hint, children }: { label: React.ReactNode; htmlFor: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-brand-muted">{label}</label>
      {children}
      {hint && <p className="text-xs text-brand-muted">{hint}</p>}
    </div>
  );
}

/** A row of mutually exclusive answers — a radiogroup with arrow-key movement. */
function Choice<T extends string>({
  label, options, value, onChange, stretch = false,
}: {
  label:    string;
  options:  readonly T[];
  value:    T | null;
  onChange: (v: T) => void;
  stretch?: boolean;
}) {
  const groupId = useId();
  function onKey(e: React.KeyboardEvent<HTMLButtonElement>, i: number) {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + options.length) % options.length;
    onChange(options[next]);
    (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
  }
  return (
    <div className="flex flex-col gap-1.5">
      <span id={groupId} className="text-xs font-medium text-brand-muted">{label}</span>
      <div role="radiogroup" aria-labelledby={groupId} className="flex flex-wrap gap-2">
        {options.map((o, i) => {
          const on = o === value;
          return (
            <button
              key={o}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on || (value === null && i === 0) ? 0 : -1}
              onClick={() => onChange(o)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                'min-h-11 rounded-[10px] px-3 text-[13px] text-brand-ink transition-colors',
                stretch && 'flex-1',
                on ? 'border-2 border-brand-primary bg-[#F4F8F5] font-semibold' : 'border border-brand-border bg-white font-medium hover:bg-brand-surface-alt',
              )}
            >
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Whole labels only; '' while empty. Commas are fine to type. */
function parseQty(raw: string): number | '' {
  const n = Number(raw.replace(/[,\s]/g, ''));
  return raw.trim() === '' || !Number.isFinite(n) ? '' : Math.floor(n);
}

function QtyInput({ id, value, onChange, placeholder, autoFocus }: {
  id: string; value: number | ''; onChange: (v: number | '') => void; placeholder?: string; autoFocus?: boolean;
}) {
  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      autoFocus={autoFocus}
      placeholder={placeholder}
      value={value === '' ? '' : value.toLocaleString('en-IN')}
      onChange={(e) => onChange(parseQty(e.target.value))}
      className={cn(dField, 'font-mono')}
    />
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
  const titleId  = useId();
  const reasonId = useId();

  return (
    <StageDialog
      titleId={titleId}
      cap={isAdmin ? 'Out of order · Admin' : 'Out of order'}
      title={<>{missingStage} isn&rsquo;t done yet</>}
      sub={<>You&rsquo;re moving to {targetStage}, but {missingStage} hasn&rsquo;t been marked complete.</>}
      onClose={onCancel}
      footer={isAdmin ? (
        <>
          <button type="button" onClick={onCancel} className={dQuiet}>Cancel</button>
          <button
            type="button"
            onClick={() => remark.trim() && onOverride(remark.trim())}
            disabled={!remark.trim()}
            className={dHold}
          >
            Skip {missingStage}
          </button>
        </>
      ) : (
        <button type="button" onClick={onCancel} className={dPrimary}>OK</button>
      )}
    >
      <Move from={missingStage} to={targetStage} />
      {isAdmin ? (
        <Field label="Reason for skipping (required)" htmlFor={reasonId} hint="Saved as an internal note on the job.">
          <textarea
            id={reasonId}
            rows={2}
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            placeholder="Stage was completed offline — updating to match"
            className={dArea}
          />
        </Field>
      ) : (
        <Note tone="warn">Stages go in order. Finish {missingStage} first, or ask Admin to skip it.</Note>
      )}
    </StageDialog>
  );
}

// ── 1b. Revert Stage Modal ────────────────────────────────────
// Admin-only, and never reached by anyone else — the picker refuses a backward
// pick outright for other departments. The reason is mandatory: it becomes the
// only record of why a job that had reached a later stage no longer has.

export function RevertStageModal({
  job,
  currentStage,
  targetStage,
  completedStages = [],
  onCancel,
  onConfirm,
}: {
  job?:             Job | null;
  currentStage:     Stage;
  targetStage:      Stage;
  /** Stages the job has a completion stamp for — the ones after the target get cleared. */
  completedStages?: Stage[];
  onCancel:         () => void;
  onConfirm:        (revertRemark: string) => void;
}) {
  const [remark, setRemark] = useState('');
  const titleId  = useId();
  const reasonId = useId();

  const cleared = Array.from(new Set([...completedStages, currentStage]))
    .filter((s) => PIPELINE_STAGES.includes(s) && stageIndex(s) > stageIndex(targetStage))
    .sort((a, b) => stageIndex(b) - stageIndex(a));

  return (
    <StageDialog
      titleId={titleId}
      cap="Admin only"
      title={<>Move <Ref job={job} /> back to {targetStage}?</>}
      sub={<>Stages normally only go forward. Going back clears {cleared.length === 1 ? 'the stage' : <><span className="font-mono">{cleared.length}</span> stages</>} after it.</>}
      onClose={onCancel}
      footer={
        <>
          <button type="button" onClick={onCancel} className={dQuiet}>Keep {currentStage}</button>
          <button
            type="button"
            onClick={() => remark.trim() && onConfirm(remark.trim())}
            disabled={!remark.trim()}
            className={dDanger}
          >
            Move back
          </button>
        </>
      }
    >
      <Note tone="warn">
        {cleared.length > 0 && <>{listWords(cleared)} {cleared.length === 1 ? 'is' : 'are'} marked incomplete again. </>}
        The tracking page shows the job back at {targetStage}. The change is logged under your department.
      </Note>
      <Move from={currentStage} to={targetStage} />
      <Field label="Reason (required)" htmlFor={reasonId}>
        <textarea
          id={reasonId}
          rows={2}
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          placeholder="Stage was marked by mistake — job is still at artwork"
          className={dArea}
        />
      </Field>
    </StageDialog>
  );
}

function listWords(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// ── 2. On Hold Modal ──────────────────────────────────────────
// A reason chip covers the common cases in one tap; the note says the rest.
// Both land in halt_remark, which the party sees on /track.

export function OnHoldModal({
  job,
  onCancel,
  onConfirm,
}: {
  job?:      Job | null;
  onCancel:  () => void;
  onConfirm: (remark: string) => void;
}) {
  const [reason, setReason] = useState<HoldReason | null>(null);
  const [note, setNote]     = useState('');
  const titleId = useId();
  const noteId  = useId();

  const remark   = holdRemark(reason, note);
  const needNote = reason === null || reason === 'Other';

  return (
    <StageDialog
      titleId={titleId}
      cap="On Hold · any department"
      title={<>Put <Ref job={job} /> on hold</>}
      sub="The floor stops work on it. It shows amber everywhere until someone resumes it."
      onClose={onCancel}
      footer={
        <>
          <button type="button" onClick={onCancel} className={dQuiet}>Cancel</button>
          <button type="button" onClick={() => remark && onConfirm(remark)} disabled={!remark} className={dHold}>
            Put on hold
          </button>
        </>
      }
    >
      <Choice label="Why" options={HOLD_REASONS} value={reason} onChange={setReason} />
      <Field
        label={needNote ? 'Note for the floor (required)' : 'Note for the floor'}
        htmlFor={noteId}
        hint="The reason and note show on the party’s tracking page."
      >
        <textarea
          id={noteId}
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Party asked to hold till the new barcode is approved. Expected Tuesday."
          className={dArea}
        />
      </Field>
      {job && job.status !== 'On Hold' && <Move from={job.status as Stage} to="On Hold" />}
    </StageDialog>
  );
}

// ── 3. QC Modal ───────────────────────────────────────────────
// Opens when a job moves into Quality Check. Three outcomes: a clean pass,
// a pass with some rolls held back for re-check (the roll numbers go into
// the remark), or a rejected batch — which stops the job on hold instead.

export function QCModal({
  job,
  onCancel,
  onConfirm,
  onReject,
}: {
  job?:      Job | null;
  onCancel:  () => void;
  onConfirm: (remark: string) => void;
  /** Present when this department may put the job on hold. */
  onReject?: (remark: string) => void;
}) {
  const options = onReject ? QC_RESULTS : QC_RESULTS.slice(0, 2);
  const [result, setResult]   = useState<QCResult>('All rolls pass');
  const [rolls, setRolls]     = useState('');
  const [remarks, setRemarks] = useState('');
  const titleId  = useId();
  const rollsId  = useId();
  const remarkId = useId();

  const valid =
    result === 'All rolls pass' ||
    (result === 'Pass with rolls held' && rolls.trim() !== '') ||
    (result === 'Reject batch' && remarks.trim() !== '');
  const remark = qcRemark(result, rolls, remarks);

  return (
    <StageDialog
      titleId={titleId}
      cap="Quality Check · QC"
      title={<>Record QC on <Ref job={job} /></>}
      sub="Packing unlocks once QC is saved. Dispatch sees the remark on the job."
      onClose={onCancel}
      footer={
        <>
          <button type="button" onClick={onCancel} className={dQuiet}>Cancel</button>
          {result === 'Reject batch' ? (
            <button type="button" onClick={() => valid && onReject?.(remark)} disabled={!valid} className={dHold}>
              Reject and put on hold
            </button>
          ) : (
            <button type="button" onClick={() => valid && onConfirm(remark)} disabled={!valid} className={dPrimary}>
              Save QC
            </button>
          )}
        </>
      }
    >
      <Choice label="Result" options={options} value={result} onChange={setResult} stretch />
      {result === 'Pass with rolls held' && (
        <Field label="Rolls held (required)" htmlFor={rollsId}>
          <input
            id={rollsId}
            value={rolls}
            onChange={(e) => setRolls(e.target.value)}
            placeholder="3, 4"
            autoComplete="off"
            className={cn(dField, 'font-mono')}
          />
        </Field>
      )}
      <Field
        label={result === 'Reject batch' ? 'What’s wrong (required)' : result === 'All rolls pass' ? 'Remarks (optional)' : 'Remarks'}
        htmlFor={remarkId}
        hint={result === 'Reject batch'
          ? 'The job goes On Hold with this reason. The party sees it on the tracking page.'
          : 'Any remark shows on the party’s tracking page. Leave blank for a clean pass.'}
      >
        <textarea
          id={remarkId}
          rows={3}
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder={result === 'Reject batch' ? 'Shade off master on every roll' : 'Minor colour variation within range'}
          className={dArea}
        />
      </Field>
    </StageDialog>
  );
}

// ── 3b. Confirm Slitting Modal ────────────────────────────────
// Postpress confirms the rolls are slit before QC may start. The roll count
// isn't a column — when given, it is written to the job's internal notes.

export function ConfirmSlittingModal({
  job,
  busy = false,
  onCancel,
  onConfirm,
}: {
  job:       Job;
  busy?:     boolean;
  onCancel:  () => void;
  onConfirm: (rollsSlit: number | null) => void;
}) {
  const [rolls, setRolls]     = useState<number | ''>('');
  const [checked, setChecked] = useState(false);
  const titleId = useId();
  const rollsId = useId();
  const checkId = useId();

  const ordered = job.label_qty ?? 0;
  const perRoll = typeof rolls === 'number' && rolls > 0 && ordered > 0 ? Math.round(ordered / rolls) : null;

  return (
    <StageDialog
      titleId={titleId}
      cap="Slitting · Postpress"
      title={<>Confirm slitting on <Ref job={job} /></>}
      sub="Quality Check stays locked until slitting is confirmed."
      onClose={onCancel}
      footer={
        <>
          <button type="button" onClick={onCancel} className={dQuiet}>Cancel</button>
          <button
            type="button"
            onClick={() => checked && onConfirm(typeof rolls === 'number' && rolls > 0 ? rolls : null)}
            disabled={!checked || busy}
            className={dPrimary}
          >
            {busy ? 'Saving…' : 'Confirm slitting'}
          </button>
        </>
      }
    >
      <Facts items={[
        ['Ordered', formatQty(ordered)],
        ['Rolls', typeof rolls === 'number' && rolls > 0 ? rolls.toLocaleString('en-IN') : '—'],
        ['Per roll', perRoll ? `~${formatQty(perRoll)}` : '—'],
      ]} />
      <Field label="Rolls slit" htmlFor={rollsId} hint="Optional. Saved to the job’s internal notes.">
        <QtyInput id={rollsId} value={rolls} onChange={setRolls} placeholder="20" />
      </Field>
      <label htmlFor={checkId} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
        <input
          id={checkId}
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="h-[22px] w-[22px] shrink-0 accent-brand-primary"
        />
        Cores and winding checked against the job card
      </label>
    </StageDialog>
  );
}

// ── 4. Partial Dispatch Modal ─────────────────────────────────
// COMPLETELY SEPARATE from Full Dispatch — different trigger, different modal, different button.

export function PartialDispatchModal({
  job,
  remaining,
  onCancel,
  onConfirm,
}: {
  job?:      Job | null;
  remaining: number;
  onCancel:  () => void;
  onConfirm: (input: PartialDispatchInput) => void;
}) {
  const [qty, setQty]             = useState<number | ''>('');
  const [stockLeft, setStockLeft] = useState<number | ''>('');
  const [rack, setRack]           = useState('');
  const [vehicle, setVehicle]     = useState('');
  const titleId   = useId();
  const qtyId     = useId();
  const stockId   = useId();
  const rackId    = useId();
  const vehicleId = useId();

  const ordered  = job?.label_qty ?? remaining;
  const sentSoFar = Math.max(ordered - remaining, 0);
  const isValid  = typeof qty === 'number' && qty > 0 && qty <= remaining;
  const tooMany  = typeof qty === 'number' && qty > remaining;

  // What is physically left on the shelf after this dispatch. Defaults to the
  // order balance, but editable: the press may have run short, so the
  // arithmetic answer is a starting point, not the truth.
  const computedLeft = isValid ? remaining - (qty as number) : remaining;
  const left = stockLeft === '' ? computedLeft : stockLeft;

  return (
    <StageDialog
      titleId={titleId}
      cap="Partial Dispatch · Dispatch"
      title={<>Send part of <Ref job={job} /></>}
      sub={job ? `${job.party} · ${job.job_name}` : undefined}
      onClose={onCancel}
      footer={
        <>
          <button type="button" onClick={onCancel} className={dQuiet}>Cancel</button>
          {/* Only ONE action here — never a full-dispatch button. */}
          <button
            type="button"
            onClick={() => isValid && onConfirm({ qty: qty as number, stockLeft: left, rack: rack.trim(), vehicle: vehicle.trim() })}
            disabled={!isValid}
            className={dPrimary}
          >
            {isValid ? `Dispatch ${formatQty(qty as number)}` : 'Dispatch'}
          </button>
        </>
      }
    >
      <Facts items={[
        ['Ordered', formatQty(ordered)],
        ['Sent so far', formatQty(sentSoFar)],
        ['Remaining', formatQty(remaining)],
      ]} />
      <Field label="Sending now (labels)" htmlFor={qtyId}>
        <QtyInput id={qtyId} value={qty} onChange={setQty} />
      </Field>
      {tooMany && <Note tone="bad">Only <b className="font-mono">{formatQty(remaining)}</b> remain on this order.</Note>}
      {isValid && (
        left > 0
          ? <Note tone="ok"><b className="font-mono">{formatQty(left)}</b> go to Label stock as <b>Remaining</b> — promised to this order.</Note>
          : <Note tone="ok">Nothing is left on the shelf for this order.</Note>
      )}
      <Field label="Left on the shelf (labels)" htmlFor={stockId} hint="Defaults to the order balance. Correct it if the shelf says otherwise.">
        <QtyInput id={stockId} value={stockLeft} onChange={setStockLeft} placeholder={computedLeft.toLocaleString('en-IN')} />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Rack" htmlFor={rackId}>
          <input id={rackId} value={rack} onChange={(e) => setRack(e.target.value)} placeholder="A-02" autoComplete="off" className={cn(dField, 'font-mono')} />
        </Field>
        <Field label="Vehicle no" htmlFor={vehicleId}>
          <input id={vehicleId} value={vehicle} onChange={(e) => setVehicle(e.target.value.toUpperCase())} placeholder="GJ 16 AX 4471" autoComplete="off" className={cn(dField, 'font-mono')} />
        </Field>
      </div>
      {vehicle.trim() && <p className="-mt-2 text-xs text-brand-muted">The vehicle number goes into the party&rsquo;s dispatch email.</p>}
    </StageDialog>
  );
}

// ── 5. Full Dispatch Modal ────────────────────────────────────
// COMPLETELY SEPARATE from Partial Dispatch. No qty input. No partial button.

export function FullDispatchModal({
  job,
  remaining,
  onCancel,
  onConfirm,
}: {
  job?:      Job | null;
  remaining: number;
  onCancel:  () => void;
  onConfirm: (input: FullDispatchInput) => void;
}) {
  const titleId   = useId();
  const extraId   = useId();
  const locId     = useId();
  const vehicleId = useId();
  const remarkId  = useId();

  // Surplus printed beyond the order. Blank means none — the question is asked
  // every time, but answering it is never a tax on the common case.
  const [extraQty, setExtraQty] = useState<number | ''>('');
  const [location, setLocation] = useState('');
  const [vehicle, setVehicle]   = useState('');
  const [remark, setRemark]     = useState('');

  const hasExtra = typeof extraQty === 'number' && extraQty > 0;
  const ordered  = job?.label_qty ?? remaining;
  const sent     = Math.max(ordered - remaining, 0);
  const due      = job?.delivery_date ? deliveryWords(job, istToday()) : null;
  const dueLine  = !due?.text ? null : due.tone === 'late' ? `${due.text[0].toUpperCase()}${due.text.slice(1)}.` : `Due ${due.text}.`;

  return (
    <StageDialog
      titleId={titleId}
      cap="Dispatched · Dispatch"
      title={<>Dispatch <Ref job={job} /></>}
      sub={job ? `${job.party} · ${job.job_name}` : 'Marks the whole order as sent.'}
      onClose={onCancel}
      footer={
        <>
          <button type="button" onClick={onCancel} className={dQuiet}>Cancel</button>
          {/* Only ONE action here — never a partial quantity. */}
          <button
            type="button"
            onClick={() => onConfirm({ extraQty: hasExtra ? (extraQty as number) : 0, location: location.trim(), remark: remark.trim(), vehicle: vehicle.trim() })}
            className={dPrimary}
          >
            Mark dispatched
          </button>
        </>
      }
    >
      <Facts items={[
        ['Ordered', formatQty(ordered)],
        ['Sent before', formatQty(sent)],
        ['Sending', formatQty(remaining)],
      ]} />
      {/* Over-runs are found now or never — once the job closes, nobody
          remembers why a pile of labels is on the shelf. */}
      <Field label="Extra labels left over" htmlFor={extraId}>
        <QtyInput id={extraId} value={extraQty} onChange={setExtraQty} placeholder="None" />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Extra to rack" htmlFor={locId}>
          <input id={locId} value={location} onChange={(e) => setLocation(e.target.value)} disabled={!hasExtra} placeholder={hasExtra ? 'C-07' : '—'} autoComplete="off" className={cn(dField, 'font-mono disabled:bg-brand-surface-alt')} />
        </Field>
        <Field label="Vehicle no" htmlFor={vehicleId}>
          <input id={vehicleId} value={vehicle} onChange={(e) => setVehicle(e.target.value.toUpperCase())} placeholder="GJ 16 AX 4471" autoComplete="off" className={cn(dField, 'font-mono')} />
        </Field>
      </div>
      {hasExtra && (
        <Field label="Note on the extra" htmlFor={remarkId}>
          <input id={remarkId} value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Setup over-run, QC passed" className={dField} />
        </Field>
      )}
      <Note tone={due?.tone === 'late' ? 'warn' : 'ok'}>
        {hasExtra
          ? <><b className="font-mono">{formatQty(extraQty as number)}</b> go to Label stock as <b>Extra</b>. </>
          : 'Nothing extra goes to stock. '}
        {dueLine && <>{dueLine} </>}
        The party&rsquo;s email waits in Dispatch emails{vehicle.trim() ? ' with the vehicle number' : ''}.
      </Note>
    </StageDialog>
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
        <WithUnit unit="labels">
            <input
            id={qtyId}
            type="number"
            inputMode="numeric"
            min={1}
            max={remainingBefore}
            value={qty}
            onChange={(e) => setQty(e.target.value ? Number(e.target.value) : '')}
            className={cn(inputCls, 'font-mono')}
          />
        </WithUnit>
        <p className="text-xs text-[var(--glass-muted)] mt-1.5">
          Up to <strong className="text-[var(--glass-ink)] font-mono">{formatQty(remainingBefore)}</strong> labels.
        </p>
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
        <WithExample example="Client requested early partial delivery">
            <textarea
            id={notesId}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className={cn(inputCls, 'resize-none')}
          />
        </WithExample>

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
  const titleId   = useId();
  const remaining = job.remaining_qty ?? Math.max((job.label_qty ?? 0) - (job.dispatched_qty ?? 0), 0);
  const ref       = jobRef(job);

  return (
    <StageDialog
      titleId={titleId}
      cap="PO Closed · Admin only"
      title={<>Close PO <span className="font-mono">{job.po_number}</span>?</>}
      sub={<>{job.party} · {job.job_name}{ref && ref !== job.po_number && <> · job <span className="font-mono">{ref}</span></>}. A closed PO leaves every list except reports. The party can still track it by PO number.</>}
      onClose={onCancel}
      footer={
        <>
          <button type="button" onClick={onCancel} className={dQuiet}>Cancel</button>
          <button type="button" onClick={onConfirm} className={dPrimary}>Close PO</button>
        </>
      }
    >
      <Facts items={[
        ['Ordered', formatQty(job.label_qty)],
        ['Dispatched', formatQty(job.dispatched_qty)],
        ['Remaining', formatQty(remaining), remaining > 0 ? 'bad' : undefined],
      ]} />
      {remaining > 0 ? (
        <Note tone="bad">
          <b><span className="font-mono">{formatQty(remaining)}</span> labels were never sent.</b>{' '}
          Any balance in Label stock as Remaining stays there after the PO closes, so it can still be used.
        </Note>
      ) : (
        <Note tone="ok">Everything ordered has been sent.</Note>
      )}
    </StageDialog>
  );
}
