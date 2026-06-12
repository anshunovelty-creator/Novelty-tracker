'use client';
// src/components/admin/AddJobForm.tsx

import React, { useState, useEffect, useRef } from 'react';
import { cn, formatQty, formatShortDate } from '@/lib/utils';
import type { Department } from '@/lib/constants/departments';
import type { AddJobFormData, ScheduledReleaseInput, JobType } from '@/lib/types';
import toast from 'react-hot-toast';

// Shape returned by /api/jobs/pm-lookup
type PmSuggestion = {
  pm_code:    string;
  party:      string;
  job_name:   string | null;
  job_type:   JobType;
  label_qty:  number | null;
  created_at: string;
};

type Props = {
  dept:          Department;
  prefillData?:  Partial<AddJobFormData>; // used by Job Duplication
  onSuccess?:    () => void;
};

const JOB_TYPES = ['New', 'Repeat', 'Artwork Changed'] as const;
const INITIAL_STAGES = [
  'PO Received',
  'Artwork Received',
  'Prepress / Design Check',
] as const;

const EMPTY_FORM: AddJobFormData = {
  po_number:            '',
  pm_code:              '',
  party:                '',
  job_name:             '',
  label_qty:            null,
  job_type:             'New',
  po_date:              '',
  delivery_date:        '',
  status:               'PO Received',
  urgent:               false,
  urgent_priority:      null,
  notes:                '',
  is_scheduled_release: false,
  scheduled_releases:   [],
};

export default function AddJobForm({ dept, prefillData, onSuccess }: Props) {
  const [form,       setForm]       = useState<AddJobFormData>({ ...EMPTY_FORM, ...prefillData });
  const [loading,    setLoading]    = useState(false);
  const [isOpen,     setIsOpen]     = useState(false);
  const [releases,   setReleases]   = useState<ScheduledReleaseInput[]>([
    { release_number: 1, planned_qty: 0, planned_date: '' },
  ]);

  // ── PM code typeahead ──────────────────────────────────────
  const [pmSuggestions,     setPmSuggestions]     = useState<PmSuggestion[]>([]);
  const [showPmSuggestions, setShowPmSuggestions] = useState(false);
  // Set after picking a suggestion so the effect doesn't immediately re-open
  // the dropdown for the value it just wrote.
  const suppressPmLookup = useRef(false);

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

    try {
      const res = await fetch('/api/jobs', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error ?? 'Failed to add job');
        return;
      }

      toast.success('Job added successfully');
      setForm({ ...EMPTY_FORM });
      setReleases([{ release_number: 1, planned_qty: 0, planned_date: '' }]);
      setIsOpen(false);
      onSuccess?.();
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className={cn(
          'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium',
          'bg-brand-accent text-white hover:bg-brand-accent/90 transition-colors'
        )}
      >
        <span className="text-lg leading-none">+</span>
        Add Job
      </button>
    );
  }

  return (
    <div className="bg-white border border-brand-border rounded-xl p-6 mb-4">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-base font-semibold text-brand-accent">Add New Job</h2>
        <button
          onClick={() => setIsOpen(false)}
          className="text-brand-muted hover:text-brand-accent text-sm"
        >
          Cancel
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Row 1: PO + PM code + Party */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="PO Number *">
            <input
              required
              value={form.po_number}
              onChange={(e) => set('po_number', e.target.value)}
              placeholder="e.g. PO/2026/001"
              className={inputCls}
            />
          </Field>
          <Field label="PM Code">
            <div className="relative">
              <input
                value={form.pm_code ?? ''}
                onChange={(e) => set('pm_code', e.target.value)}
                onFocus={() => pmSuggestions.length > 0 && setShowPmSuggestions(true)}
                onBlur={() => setTimeout(() => setShowPmSuggestions(false), 150)}
                placeholder="e.g. PM-4521"
                autoComplete="off"
                className={inputCls}
              />
              {showPmSuggestions && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-brand-border rounded-lg shadow-lg overflow-hidden">
                  <p className="px-3 py-1.5 text-xs text-brand-muted bg-brand-bg border-b border-brand-border">
                    Earlier jobs — click to autofill
                  </p>
                  {pmSuggestions.map((s) => (
                    <button
                      key={s.pm_code}
                      type="button"
                      // onMouseDown fires before the input's onBlur closes the list
                      onMouseDown={(e) => { e.preventDefault(); applyPmSuggestion(s); }}
                      className="w-full text-left px-3 py-2 hover:bg-brand-bg transition-colors border-b border-brand-border/50 last:border-0"
                    >
                      <span className="block font-mono text-xs font-medium text-brand-accent">
                        {s.pm_code}
                      </span>
                      <span className="block text-xs text-brand-muted truncate">
                        {s.party}{s.job_name ? ` · ${s.job_name}` : ''}
                      </span>
                      <span className="block text-[11px] text-brand-muted/70 mt-0.5">
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
            <input
              required
              value={form.party}
              onChange={(e) => set('party', e.target.value)}
              placeholder="e.g. UPL Limited"
              className={inputCls}
            />
          </Field>
        </div>

        {/* Row 2: Job name + Label qty + Job type */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Job Name">
            <input
              value={form.job_name ?? ''}
              onChange={(e) => set('job_name', e.target.value)}
              placeholder="Product / label name"
              className={inputCls}
            />
          </Field>
          <Field label="Label Qty">
            <input
              type="number"
              min={1}
              value={form.label_qty ?? ''}
              onChange={(e) => set('label_qty', e.target.value ? Number(e.target.value) : null)}
              placeholder="e.g. 500000"
              className={cn(inputCls, 'font-mono')}
            />
          </Field>
          <Field label="Job Type">
            <select
              value={form.job_type}
              onChange={(e) => set('job_type', e.target.value as typeof form.job_type)}
              className={inputCls}
            >
              {JOB_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
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

        {/* Row 4: Urgent toggle */}
        <div className="flex items-center gap-4 flex-wrap">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.urgent}
              onChange={(e) => set('urgent', e.target.checked)}
              className="w-4 h-4 accent-brand-accent"
            />
            <span className="text-sm font-medium text-brand-accent">Urgent</span>
          </label>

          {form.urgent && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-brand-muted">Priority:</span>
              {[1, 2, 3, 4, 5].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => set('urgent_priority', p)}
                  className={cn(
                    'w-8 h-8 rounded-full text-xs font-mono font-medium transition-colors',
                    form.urgent_priority === p
                      ? 'bg-brand-accent text-white'
                      : 'bg-brand-bg border border-brand-border text-brand-muted hover:text-brand-accent'
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Row 5: Notes */}
        <Field label="Notes">
          <textarea
            value={form.notes ?? ''}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Any additional notes…"
            rows={2}
            className={cn(inputCls, 'resize-none')}
          />
        </Field>

        {/* Row 6: Scheduled release toggle */}
        <div className="border border-brand-border rounded-lg p-4 space-y-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_scheduled_release}
              onChange={(e) => set('is_scheduled_release', e.target.checked)}
              className="w-4 h-4 accent-brand-accent"
            />
            <span className="text-sm font-medium text-brand-accent">
              Scheduled Release Order
            </span>
            <span className="text-xs text-brand-muted">
              (dispatched in planned phases)
            </span>
          </label>

          {form.is_scheduled_release && (
            <div className="space-y-3">
              {releases.map((release, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-1 text-center">
                    <span className="text-xs text-brand-muted font-mono">R{release.release_number}</span>
                  </div>
                  <div className="col-span-4">
                    <input
                      type="number"
                      min={1}
                      value={release.planned_qty || ''}
                      onChange={(e) => updateRelease(idx, 'planned_qty', Number(e.target.value))}
                      placeholder="Qty"
                      className={cn(inputCls, 'font-mono text-xs')}
                    />
                  </div>
                  <div className="col-span-5">
                    <input
                      type="date"
                      value={release.planned_date}
                      onChange={(e) => updateRelease(idx, 'planned_date', e.target.value)}
                      className={cn(inputCls, 'text-xs')}
                    />
                  </div>
                  <div className="col-span-2 flex justify-end">
                    {releases.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeRelease(idx)}
                        className="text-brand-muted hover:text-red-500 text-lg leading-none transition-colors"
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
                className="text-sm text-brand-muted hover:text-brand-accent transition-colors"
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
            onClick={() => setIsOpen(false)}
            className="px-4 py-2 text-sm text-brand-muted hover:text-brand-accent transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className={cn(
              'px-5 py-2 rounded-lg text-sm font-medium bg-brand-accent text-white',
              'hover:bg-brand-accent/90 transition-colors',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {loading ? 'Adding…' : 'Add Job'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────

const inputCls = cn(
  'w-full px-3 py-2 rounded-lg border text-sm',
  'bg-white border-brand-border text-brand-accent',
  'placeholder:text-brand-muted',
  'focus:outline-none focus:ring-2 focus:ring-brand-accent/20 focus:border-brand-accent',
  'transition-colors'
);

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-brand-muted mb-1.5 uppercase tracking-wide">
        {label}
      </label>
      {children}
    </div>
  );
}
