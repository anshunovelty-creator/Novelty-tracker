'use client';
// src/components/admin/AddJobForm.tsx

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { cn, formatQty, formatShortDate } from '@/lib/utils';
import type { DeptPermissions } from '@/lib/constants/departments';
import type { AddJobFormData, ScheduledReleaseInput, JobType, PrintingUnit, LabelStock, Job } from '@/lib/types';
import { LoadingButton } from '@/components/ui/Loading';
import toast from 'react-hot-toast';
import { usePrintingUnits } from '@/hooks/useReferenceData';
import { WithExample, WithUnit } from '@/components/ui/FieldAffix';

const NO_UNITS: PrintingUnit[] = [];

// Shape returned by /api/jobs/pm-lookup
type PmSuggestion = {
  pm_code:    string;
  party:      string;
  job_name:   string | null;
  job_type:   JobType;
  label_qty:  number | null;
  created_at: string;
};

// Shape returned by /api/stock/match
type StockMatch = {
  available:     LabelStock[];  // Extra + Manual — free to use
  committed:     LabelStock[];  // Remaining — already promised to an open order
  available_qty: number;
};

type Props = {
  // Received as a plain department key by some callers (JobSeparationManager)
  // and as a full permission set by others (JobsTable) — never read inside
  // this form, so both shapes are accepted rather than forcing one caller
  // to adapt.
  dept:          DeptPermissions | string;
  prefillData?:  Partial<AddJobFormData>; // used by Job Duplication
  onSuccess?:    (job: Job) => void;
  // Set when opened from the Job Separation worksheet's "Add Job" button —
  // submits to that row's create-job endpoint instead of POST /api/jobs, so
  // the row can be stamped with the resulting job and can't be used twice.
  sourceJobSeparationId?: string;
  // Called when the form collapses without submitting (Cancel, either
  // button). Lets a caller that wraps this in its own modal overlay (the
  // Job Separation "Add Job" button) close that overlay too, instead of
  // leaving it open around the collapsed "+ Add Job" trigger.
  onCancel?: () => void;
  // When true, renders nothing (instead of the "+ Add Job" trigger button)
  // while closed — for a caller whose own button opens this form via the
  // imperative handle below (JobsTable, once the dashboard toolbar owns the
  // visible "Add Job" button).
  hideTrigger?: boolean;
};

export type AddJobFormHandle = { open: () => void };

// Repeat first and preselected: most orders are reruns of an existing label,
// so New is the one to pick deliberately.
const JOB_TYPES = ['Repeat', 'New', 'Artwork Changed'] as const;
const INITIAL_STAGES = [
  'PO Received',
  'Artwork Pending',
  'Plate Status',
  'Job Card Done',
] as const;

const EMPTY_FORM: AddJobFormData = {
  po_number:            '',
  pm_code:              '',
  party:                '',
  job_name:             '',
  label_qty:            null,
  job_type:             'Repeat',
  po_date:              '',
  delivery_date:        '',
  status:               'PO Received',
  urgent:               false,
  urgent_priority:      null,
  notes:                '',
  is_scheduled_release: false,
  scheduled_releases:   [],
  // Jobs start on Flexo; leaving the unit null lets the DB trigger assign
  // that method's default unit.
  printing_method:      'Flexo',
  printing_unit_id:     null,
};

const AddJobForm = React.forwardRef<AddJobFormHandle, Props>(function AddJobForm(
  { dept, prefillData, onSuccess, sourceJobSeparationId, onCancel, hideTrigger }, ref,
) {
  const [form,       setForm]       = useState<AddJobFormData>({ ...EMPTY_FORM, ...prefillData });
  // Active units only — a retired unit must never be assignable to a new job.
  const [loading,    setLoading]    = useState(false);
  // Open straight away when duplicating — JobsTable remounts us with a fresh
  // key and the prefill, and a collapsed form would hide it (which made the
  // Duplicate button look like it did nothing).
  const [isOpen,     setIsOpen]     = useState(Boolean(prefillData));
  // Lets an external trigger (the dashboard toolbar's "Add Job" button, once
  // hideTrigger suppresses this form's own button) open it without owning
  // isOpen itself — duplicating via a row's button still works exactly as
  // before through prefillData above.
  React.useImperativeHandle(ref, () => ({ open: () => setIsOpen(true) }), []);
  const [releases,   setReleases]   = useState<ScheduledReleaseInput[]>([
    { release_number: 1, planned_qty: 0, planned_date: '' },
  ]);

  // ── PM code typeahead ──────────────────────────────────────
  const [pmSuggestions,     setPmSuggestions]     = useState<PmSuggestion[]>([]);
  const [showPmSuggestions, setShowPmSuggestions] = useState(false);
  // Set after picking a suggestion so the effect doesn't immediately re-open
  // the dropdown for the value it just wrote.
  const suppressPmLookup = useRef(false);

  // ── Stock already on the shelf for this PM code ────────────
  const [stockMatch, setStockMatch] = useState<StockMatch | null>(null);

  // Load assignable units once the form opens (shared cache). A failure is
  // non-fatal: the unit select falls back to "no units configured" and the
  // DB trigger still assigns the method's default on insert.
  const { data: units = NO_UNITS } = usePrintingUnits<PrintingUnit>({ enabled: isOpen });

  useEffect(() => {
    if (!isOpen) return;
    if (suppressPmLookup.current) {
      suppressPmLookup.current = false;
      return;
    }
    const code = form.pm_code?.trim() ?? '';
    if (code.length < 2) {
      setPmSuggestions([]);
      setShowPmSuggestions(false);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res  = await fetch(`/api/jobs/pm-lookup?code=${encodeURIComponent(code)}`);
        const data = await res.json();
        if (res.ok) {
          const matches: PmSuggestion[] = data.matches ?? [];
          setPmSuggestions(matches);
          setShowPmSuggestions(matches.length > 0);
        }
      } catch {
        // lookup is best-effort — never block manual entry
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [form.pm_code, isOpen]);

  // Deliberately not gated on suppressPmLookup: picking a suggestion is a
  // repeat order, which is exactly when the shelf is worth checking. It is
  // also not gated on job_type — a "New" job whose PM code already has
  // stock is the surprise most worth catching.
  useEffect(() => {
    if (!isOpen) return;
    const code = form.pm_code?.trim() ?? '';
    if (code.length < 2) {
      setStockMatch(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/stock/match?pm_code=${encodeURIComponent(code)}`);
        if (!res.ok) return;
        const data: StockMatch = await res.json();
        if (!cancelled) setStockMatch(data);
      } catch {
        // Best-effort: a failed shelf check must never block job entry.
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [form.pm_code, isOpen]);

  function applyPmSuggestion(s: PmSuggestion) {
    suppressPmLookup.current = true;
    const today = new Date().toISOString().slice(0, 10);
    setForm((prev) => ({
      ...prev,
      pm_code:  s.pm_code,
      party:    s.party,
      job_name: s.job_name ?? '',
      // This PM code was produced before — that's the definition of a Repeat
      // job (skips sample/shade card stages). Changeable in the dropdown.
      job_type: 'Repeat',
      po_date:  prev.po_date || today,
    }));
    setShowPmSuggestions(false);
    setPmSuggestions([]);
    toast.success('Autofilled from earlier job — type set to Repeat');
  }

  function set<K extends keyof AddJobFormData>(key: K, value: AddJobFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function addRelease() {
    setReleases((prev) => [
      ...prev,
      { release_number: prev.length + 1, planned_qty: 0, planned_date: '' },
    ]);
  }

  function removeRelease(idx: number) {
    setReleases((prev) =>
      prev
        .filter((_, i) => i !== idx)
        .map((r, i) => ({ ...r, release_number: i + 1 }))
    );
  }

  function updateRelease(idx: number, field: keyof ScheduledReleaseInput, value: string | number) {
    setReleases((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r))
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const payload: AddJobFormData = {
      ...form,
      scheduled_releases: form.is_scheduled_release ? releases : [],
    };

    const url = sourceJobSeparationId
      ? `/api/job-separations/${sourceJobSeparationId}/create-job`
      : '/api/jobs';

    try {
      const res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error ?? 'Failed to add job');
        return;
      }

      if (data.warning) {
        // Job was created but this row's link-back write failed or lost a
        // race — the job itself is fine, so this is a heads-up, not an error.
        toast.error(data.warning);
      } else {
        toast.success('Job added successfully');
      }
      setForm({ ...EMPTY_FORM });
      setReleases([{ release_number: 1, planned_qty: 0, planned_date: '' }]);
      setIsOpen(false);
      onSuccess?.(data.job);
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (!isOpen) {
    if (hideTrigger) return null;
    return (
      <button
        onClick={() => setIsOpen(true)}
        className={cn(
          'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium',
          'bg-brand-primary text-white hover:bg-brand-primary/90 transition-colors'
        )}
      >
        <span className="text-lg leading-none">+</span>
        Add Job
      </button>
    );
  }

  return (
    <div className="glass rounded-xl p-6 mb-4">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold tracking-[-0.01em] text-[var(--glass-ink)]">Add job</h2>
          <span className="text-[13px] text-[var(--glass-muted)]">A job card number is given on save.</span>
        </div>
        <button
          type="button"
          onClick={() => { setIsOpen(false); onCancel?.(); }}
          aria-label="Close"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-black/[0.05] text-[var(--glass-ink)] hover:bg-black/[0.08]"
        >
          <X className="h-[18px] w-[18px]" aria-hidden="true" />
        </button>
      </div>

      {sourceJobSeparationId && (
        <p className="text-xs text-[var(--glass-muted)] -mt-3 mb-4">
          Prefilled from the Job Separation row — Delivery Date and Job Type
          are left blank for the team to verify and fill in.
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Job type first: it decides which stages the job will go through. */}
        <div className="flex flex-col gap-2">
          <div role="radiogroup" aria-label="Job type" className="flex gap-2">
            {JOB_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={form.job_type === t}
                onClick={() => set('job_type', t)}
                className={segCls(form.job_type === t)}
              >
                {t === 'Artwork Changed' ? 'Artwork changed' : t}
              </button>
            ))}
          </div>
          <p className="text-[13px] text-[var(--glass-muted)]">{JOB_TYPE_HINT[form.job_type]}</p>
        </div>

        {/* Row 1: PO + PM code + Party */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="PO Number *">
            <WithExample example="PO/2026/001">
                <input
                required
                value={form.po_number}
                onChange={(e) => set('po_number', e.target.value)}
                className={inputCls}
              />
            </WithExample>
          </Field>
          <Field label="PM Code">
            <div className="relative">
              <WithExample example="PM-4521">
                  <input
                  value={form.pm_code ?? ''}
                  onChange={(e) => set('pm_code', e.target.value)}
                  onFocus={() => pmSuggestions.length > 0 && setShowPmSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowPmSuggestions(false), 150)}
                  autoComplete="off"
                  className={inputCls}
                />
              </WithExample>
              {showPmSuggestions && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 glass-strong glass rounded-lg shadow-lg overflow-hidden">
                  <p className="px-3 py-1.5 text-xs text-[var(--glass-muted)] bg-white/[0.06] border-b border-white/10">
                    Earlier jobs — click to autofill
                  </p>
                  {pmSuggestions.map((s) => (
                    <button
                      key={s.pm_code}
                      type="button"
                      // onMouseDown fires before the input's onBlur closes the list
                      onMouseDown={(e) => { e.preventDefault(); applyPmSuggestion(s); }}
                      className="w-full text-left px-3 py-2 hover:bg-white/[0.08] transition-colors border-b border-white/10 last:border-0"
                    >
                      <span className="block font-mono text-xs font-medium text-[var(--glass-ink)]">
                        {s.pm_code}
                      </span>
                      <span className="block text-xs text-[var(--glass-muted)] truncate">
                        {s.party}{s.job_name ? ` · ${s.job_name}` : ''}
                      </span>
                      <span className="block text-[11px] text-[var(--glass-muted)] mt-0.5">
                        Last order: {formatShortDate(s.created_at)}
                        {s.label_qty ? ` · ${formatQty(s.label_qty)} labels` : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Field>
          <Field label="Party / Client *">
            <WithExample example="UPL Limited">
                <input
                required
                value={form.party}
                onChange={(e) => set('party', e.target.value)}
                className={inputCls}
              />
            </WithExample>
          </Field>
        </div>

        {/* Shelf stock for the typed PM code. Sits directly under the PM
             field so it is read before the quantity is decided, not after
             the job has already been booked onto a press. */}
        {stockMatch && (stockMatch.available.length > 0 || stockMatch.committed.length > 0) && (
          <ShelfStockCallout match={stockMatch} orderQty={form.label_qty} />
        )}

        {/* Row 2: Job name + Label qty */}
        <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-3">
          <Field label="Job Name">
            <input
              value={form.job_name ?? ''}
              onChange={(e) => set('job_name', e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Label Qty">
            <WithUnit unit="labels">
                <input
                type="number"
                min={1}
                value={form.label_qty ?? ''}
                onChange={(e) => set('label_qty', e.target.value ? Number(e.target.value) : null)}
                className={cn(inputCls, 'font-mono')}
              />
            </WithUnit>
          </Field>
        </div>

        {/* Row 2b: Printing unit.
             Method is not asked for — each unit runs one process (Unit-1
             Offset, Unit-2 Flexo), so the unit already determines it. The
             server reads the method off the chosen unit; the option labels
             show it so the floor can see what they are picking. */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--glass-muted)]">Printing unit</span>
          {units.length === 0 ? (
            <p className="text-sm text-[var(--glass-muted)]">No units configured — the job can be assigned later.</p>
          ) : (
            <div role="radiogroup" aria-label="Printing unit" className="flex flex-wrap gap-2">
              {units.map((u, i) => (
                <button
                  key={u.id}
                  type="button"
                  role="radio"
                  aria-checked={form.printing_unit_id === u.id}
                  onClick={() => set('printing_unit_id', u.id)}
                  className={cn(segCls(form.printing_unit_id === u.id), 'min-w-[160px]')}
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-primary font-mono text-[11px] font-semibold text-white">{i + 1}</span>
                  {u.name} · {u.printing_method}
                </button>
              ))}
              <button
                type="button"
                role="radio"
                aria-checked={!form.printing_unit_id}
                onClick={() => set('printing_unit_id', null)}
                className={cn(segCls(!form.printing_unit_id), 'min-w-[140px]')}
              >
                Decide later
              </button>
            </div>
          )}
        </div>

        {/* Row 3: PO date + Delivery date + Initial status */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="PO Date">
            <input
              type="date"
              value={form.po_date ?? ''}
              onChange={(e) => set('po_date', e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Delivery Date">
            <input
              type="date"
              value={form.delivery_date ?? ''}
              onChange={(e) => set('delivery_date', e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Initial Status">
            <select
              value={form.status}
              onChange={(e) => set('status', e.target.value as typeof form.status)}
              className={inputCls}
            >
              {INITIAL_STAGES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>
        </div>

        {/* Row 4: Urgent + priority. Priority only means something on an
             urgent job, so it is greyed out until Urgent is ticked. */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={form.urgent}
              onChange={(e) => { set('urgent', e.target.checked); if (!e.target.checked) set('urgent_priority', null); }}
              className="h-5 w-5 accent-brand-primary"
            />
            <span className="text-sm font-semibold text-[var(--glass-ink)]">Urgent</span>
          </label>
          <div role="radiogroup" aria-label="Priority, 1 is highest" className={cn('flex items-center gap-2', !form.urgent && 'opacity-40')}>
            <span className="mr-1 text-xs font-medium uppercase tracking-wide text-[var(--glass-muted)]">Priority</span>
            {[1, 2, 3, 4, 5].map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={form.urgent_priority === p}
                aria-label={`Priority ${p}`}
                disabled={!form.urgent}
                onClick={() => set('urgent_priority', p)}
                className={cn(
                  'h-11 w-11 rounded-lg border font-mono text-sm font-semibold transition-colors',
                  form.urgent_priority === p
                    ? 'border-[#b91c1c] bg-[#b91c1c] text-white'
                    : 'border-[var(--field-border)] bg-white text-[var(--glass-ink)] hover:border-[#C9D6CF]',
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Row 5: Notes */}
        <Field label="Notes">
          <textarea
            value={form.notes ?? ''}
            onChange={(e) => set('notes', e.target.value)}
            rows={2}
            className={cn(inputCls, 'resize-none')}
          />
        </Field>

        {/* Row 6: Scheduled release toggle */}
        <div className="border border-white/10 rounded-lg p-4 space-y-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_scheduled_release}
              onChange={(e) => set('is_scheduled_release', e.target.checked)}
              className="w-4 h-4 accent-emerald-400"
            />
            <span className="text-sm font-medium text-[var(--glass-ink)]">
              Scheduled Release Order
            </span>
            <span className="text-xs text-[var(--glass-muted)]">
              (dispatched in planned phases)
            </span>
          </label>

          {form.is_scheduled_release && (
            <div className="space-y-3">
              <div className="grid grid-cols-12 gap-2 text-xs text-[var(--glass-muted)]" aria-hidden="true">
                <span className="col-span-1" />
                <span className="col-span-4">Qty</span>
                <span className="col-span-5">Planned date</span>
              </div>
              {releases.map((release, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-1 text-center">
                    <span className="text-xs text-[var(--glass-muted)] font-mono">R{release.release_number}</span>
                  </div>
                  <div className="col-span-4">
                    <input
                      type="number"
                      min={1}
                      value={release.planned_qty || ''}
                      onChange={(e) => updateRelease(idx, 'planned_qty', Number(e.target.value))}
                      aria-label={`Release ${release.release_number} quantity`}
                      className={cn(inputCls, 'font-mono text-xs')}
                    />
                  </div>
                  <div className="col-span-5">
                    <input
                      type="date"
                      value={release.planned_date}
                      aria-label={`Release ${release.release_number} planned date`}
                      onChange={(e) => updateRelease(idx, 'planned_date', e.target.value)}
                      className={cn(inputCls, 'text-xs')}
                    />
                  </div>
                  <div className="col-span-2 flex justify-end">
                    {releases.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeRelease(idx)}
                        className="text-[var(--glass-muted)] hover:text-red-300 text-lg leading-none transition-colors"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={addRelease}
                className="text-sm text-[var(--glass-muted)] hover:text-[var(--glass-ink)] transition-colors"
              >
                + Add release
              </button>
            </div>
          )}
        </div>

        {/* Submit */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => { setIsOpen(false); onCancel?.(); }}
            className="min-h-11 rounded-[10px] border border-[var(--field-border)] bg-white px-4 text-sm font-medium text-[var(--glass-ink)] transition-colors hover:bg-black/[0.03]"
          >
            Cancel
          </button>
          <LoadingButton
            type="submit"
            loading={loading}
            loadingStages={['Saving job…', 'Creating timeline…', 'Almost done…']}
            className="min-h-11 rounded-[10px] bg-brand-primary px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-primary-hover disabled:opacity-50"
          >
            Create job
          </LoadingButton>
        </div>
      </form>
    </div>
  );
});

export default AddJobForm;

// ── Helpers ──────────────────────────────────────────────────

/** One option in a segmented choice — the selected one gets the 2px brand border. */
const segCls = (on: boolean) => cn(
  'flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-sm text-[var(--glass-ink)] transition-colors',
  on ? 'border-2 border-brand-primary bg-[#F4F8F5] font-semibold' : 'border border-[var(--field-border)] bg-white font-medium hover:border-[#C9D6CF]',
);

/** What each job type changes about the pipeline, said once under the choice. */
const JOB_TYPE_HINT: Record<(typeof JOB_TYPES)[number], string> = {
  'New':             'Goes through every stage, sample print and shade card included.',
  'Repeat':          'Repeat skips Sample Printing and both shade card stages.',
  'Artwork Changed': 'Same label, new artwork — goes through every stage again.',
};

const inputCls = cn(
  'w-full px-3.5 py-2.5 rounded-xl text-sm bg-[var(--field-bg)] border border-[var(--field-border)]',
  'text-[var(--glass-ink)] placeholder:text-[var(--glass-muted)] backdrop-blur-md',
  'focus:outline-none focus:border-emerald-300/70 focus:bg-white/[0.14]',
  'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
  '[&>option]:bg-white [&>option]:text-[var(--glass-ink)]',
);

/**
 * "You already have these" — shown while a job is being entered.
 *
 * Amber, not red: nothing is wrong and nothing is blocked. The order may
 * well still be printed in full. The panel exists so that decision is
 * made knowingly rather than by default.
 */
function ShelfStockCallout({
  match,
  orderQty,
}: {
  match: StockMatch;
  orderQty: number | null;
}) {
  const { available, committed, available_qty } = match;
  const hasFree      = available_qty > 0;
  const coversOrder  = hasFree && orderQty !== null && orderQty > 0 && available_qty >= orderQty;
  const committedQty = committed.reduce((sum, s) => sum + s.qty, 0);

  return (
    <div
      role="status"
      className={cn(
        'rounded-xl border px-4 py-3 space-y-2',
        hasFree
          ? 'border-amber-300/40 bg-amber-400/[0.12]'
          : 'border-[var(--glass-border)] bg-[var(--glass-bg)]'
      )}
    >
      {hasFree ? (
        <p className="text-sm text-[var(--glass-ink)]">
          <strong className="font-semibold">{formatQty(available_qty)} labels</strong>{' '}
          for this PM code are already on the shelf
          {coversOrder && (
            <> — enough to cover this order of {formatQty(orderQty)}</>
          )}
          .
        </p>
      ) : (
        <p className="text-sm text-[var(--glass-ink)]">
          No free stock for this PM code, but an open order is still holding some.
        </p>
      )}

      {available.length > 0 && (
        <ul className="space-y-1">
          {available.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap gap-x-2 text-xs text-[var(--glass-muted)]"
            >
              <span className="font-mono font-medium text-[var(--glass-ink)]">
                {formatQty(s.qty)}
              </span>
              <span>{s.kind}</span>
              {s.location && <span>· {s.location}</span>}
              <span>· {s.party}</span>
              {s.po_number && <span>· {s.po_number}</span>}
              <span>· {formatShortDate(s.created_at)}</span>
            </li>
          ))}
        </ul>
      )}

      {committedQty > 0 && (
        <p className="text-xs text-[var(--glass-muted)]">
          Plus {formatQty(committedQty)} held as the unshipped balance of an open
          order — not free to use.
        </p>
      )}

      <Link
        href="/admin/stock"
        target="_blank"
        className={cn(
          'inline-flex items-center min-h-[44px] -my-2 text-xs font-medium',
          'text-[var(--glass-ink)] underline underline-offset-[3px] decoration-current/40',
          'hover:decoration-current focus-visible:outline-none focus-visible:ring-2',
          'focus-visible:ring-emerald-400/70 rounded'
        )}
      >
        Open stock list
      </Link>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-[var(--glass-muted)] mb-1.5 uppercase tracking-wide">
        {label}
      </label>
      {children}
    </div>
  );
}
