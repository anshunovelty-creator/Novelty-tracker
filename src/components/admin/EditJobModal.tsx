'use client';
// src/components/admin/EditJobModal.tsx
// One Edit button per job opens this: every correctable field, pre-filled,
// with a single Save at the bottom. This is the repair path for a job that
// was entered wrong — not a second way to run the pipeline.
//
// Deliberately absent:
//   • Job card number — auto-issued and sequential, printed on the card.
//   • Status — the row dropdown owns it, because a stage change has to run
//     prerequisite checks and open the QC / on-hold / dispatch modals.
//
// Only changed fields are sent. That keeps the PATCH honest about intent and
// means a field the department may not touch never appears in the request at
// all, so it cannot 403 an otherwise-valid save.

import React, { useState, useEffect, useId } from 'react';
import { Save, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { ModalShell } from './modals';
import type { Job, PrintingUnit, JobType, PrintingMethod } from '@/lib/types';
import { canDeptEditDeliveryDate } from '@/lib/constants/departments';
import type { DeptPermissions } from '@/lib/constants/departments';

const JOB_TYPES: JobType[] = ['New', 'Repeat', 'Artwork Changed'];

const inputCls = cn(
  'w-full px-3 py-2 rounded-lg text-sm bg-[var(--glass-bg)] border border-[var(--glass-border)]',
  'text-[var(--glass-ink)] placeholder:text-[var(--glass-muted)]',
  'focus:outline-none focus:border-emerald-300/70 focus:bg-white/[0.14]',
  'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
  '[&>option]:bg-[var(--select-option-bg)] [&>option]:text-[var(--glass-ink)]',
);

/** The editable shape — a flat mirror of the Job fields this form owns. */
type EditForm = {
  po_number:        string;
  party:            string;
  pm_code:          string;
  job_name:         string;
  label_qty:        string;   // kept as text so the field can be emptied
  job_type:         JobType;
  po_date:          string;
  delivery_date:    string;
  printing_method:  PrintingMethod;
  printing_unit_id: string;
  notes:            string;
};

function toForm(job: Job): EditForm {
  return {
    po_number:        job.po_number,
    party:            job.party,
    pm_code:          job.pm_code   ?? '',
    job_name:         job.job_name  ?? '',
    label_qty:        job.label_qty != null ? String(job.label_qty) : '',
    job_type:         job.job_type,
    po_date:          job.po_date       ?? '',
    delivery_date:    job.delivery_date ?? '',
    printing_method:  job.printing_method,
    printing_unit_id: job.printing_unit_id ?? '',
    notes:            job.notes ?? '',
  };
}

type Props = {
  job:     Job;
  dept:    DeptPermissions;
  onClose: () => void;
  onSaved: (job: Job) => void;
};

export default function EditJobModal({ job, dept, onClose, onSaved }: Props) {
  const titleId = useId();
  const [form,   setForm]   = useState<EditForm>(() => toForm(job));
  const [units,  setUnits]  = useState<PrintingUnit[]>([]);
  const [saving, setSaving] = useState(false);

  // Dispatch and Admin own the delivery date (see the PATCH guard). Showing
  // Prepress a field their save would be rejected for is a worse experience
  // than not showing it.
  const canEditDelivery = canDeptEditDeliveryDate(dept);

  // Active units only — a retired unit must never become assignable again.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/printing-units');
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setUnits(json.units ?? []);
      } catch {
        // Non-fatal: the unit select falls back to "no units configured".
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function set<K extends keyof EditForm>(key: K, value: EditForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!form.po_number.trim()) { toast.error('PO number is required'); return; }
    if (!form.party.trim())     { toast.error('Party is required');     return; }

    // Diff against the original. Empty text becomes null for the nullable
    // columns, so clearing a field actually clears it rather than storing ''.
    const original = toForm(job);
    const updates: Record<string, unknown> = {};

    if (form.po_number.trim() !== original.po_number) updates.po_number = form.po_number.trim();
    if (form.party.trim()     !== original.party)     updates.party     = form.party.trim();
    if (form.pm_code.trim()   !== original.pm_code)   updates.pm_code   = form.pm_code.trim()  || null;
    if (form.job_name.trim()  !== original.job_name)  updates.job_name  = form.job_name.trim() || null;
    if (form.label_qty        !== original.label_qty) updates.label_qty = form.label_qty ? Number(form.label_qty) : null;
    if (form.job_type         !== original.job_type)  updates.job_type  = form.job_type;
    if (form.po_date          !== original.po_date)   updates.po_date   = form.po_date || null;
    if (form.notes.trim()     !== original.notes)     updates.notes     = form.notes.trim() || null;
    if (canEditDelivery && form.delivery_date !== original.delivery_date) {
      updates.delivery_date = form.delivery_date || null;
    }
    // Only the unit is sent. PATCH /api/jobs/[id] derives printing_method
    // from it, so the two can never drift apart.
    if (form.printing_unit_id !== original.printing_unit_id) {
      updates.printing_unit_id = form.printing_unit_id || null;
    }

    if (Object.keys(updates).length === 0) {
      toast('Nothing changed');
      onClose();
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(updates),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to save changes');
        return;
      }
      onSaved(data.job as Job);
      toast.success('Job updated');
      onClose();
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell titleId={titleId} onClose={saving ? undefined : onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col max-h-[85vh]">
        {/* Header — the card number says which job, without being editable */}
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-white/12 shrink-0">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-[var(--glass-ink)]">
              Edit Job
            </h2>
            <p className="text-xs text-[var(--glass-muted)] mt-0.5">
              <span className="font-mono font-semibold">
                {job.job_card_number?.toUpperCase() ?? job.po_number}
              </span>
              <span className="ml-2">Card number and status are not editable here</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close without saving"
            className="p-1.5 -m-1.5 rounded-lg text-[var(--glass-muted)] hover:text-[var(--glass-ink)] hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Fields — scrolls if the viewport is short, so Save stays reachable */}
        <div className="px-5 py-4 overflow-y-auto space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="PO Number" required>
              <input
                required
                value={form.po_number}
                onChange={(e) => set('po_number', e.target.value)}
                placeholder="e.g. PO/2026/001"
                className={cn(inputCls, 'font-mono')}
              />
            </FormField>
            <FormField label="PM Code">
              <input
                value={form.pm_code}
                onChange={(e) => set('pm_code', e.target.value)}
                placeholder="e.g. PM-4521"
                autoComplete="off"
                className={cn(inputCls, 'font-mono')}
              />
            </FormField>
          </div>

          <FormField label="Party / Client" required>
            <input
              required
              value={form.party}
              onChange={(e) => set('party', e.target.value)}
              placeholder="e.g. DHANUKA - SANAND"
              className={inputCls}
            />
          </FormField>

          <FormField label="Job Name">
            <input
              value={form.job_name}
              onChange={(e) => set('job_name', e.target.value)}
              placeholder="e.g. Haz Label Printed Diafenthiuron 50% WP"
              className={inputCls}
            />
          </FormField>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Label Qty">
              <input
                type="number"
                min={1}
                value={form.label_qty}
                onChange={(e) => set('label_qty', e.target.value)}
                placeholder="e.g. 500000"
                className={cn(inputCls, 'font-mono')}
              />
            </FormField>
            <FormField label="Job Type">
              <select
                value={form.job_type}
                onChange={(e) => set('job_type', e.target.value as JobType)}
                className={inputCls}
              >
                {JOB_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </FormField>
          </div>

          {/* Printing unit only. The unit fixes the method (Unit-1 Offset,
              Unit-2 Flexo), so asking for both invited the mismatch this
              form warns about elsewhere. The server reads the method off
              the unit; the labels show it so the choice stays legible. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Printing Unit">
              <select
                value={form.printing_unit_id}
                onChange={(e) => set('printing_unit_id', e.target.value)}
                disabled={units.length === 0}
                className={cn(inputCls, 'disabled:opacity-60')}
              >
                <option value="">
                  {units.length === 0 ? 'No units configured' : 'Not assigned'}
                </option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>{u.name} · {u.printing_method}</option>
                ))}
              </select>
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="PO Date">
              <input
                type="date"
                value={form.po_date}
                onChange={(e) => set('po_date', e.target.value)}
                className={cn(inputCls, 'font-mono')}
              />
            </FormField>
            <FormField
              label="Delivery Date"
              hint={canEditDelivery ? undefined : 'Dispatch or Admin only'}
            >
              <input
                type="date"
                value={form.delivery_date}
                onChange={(e) => set('delivery_date', e.target.value)}
                disabled={!canEditDelivery}
                className={cn(inputCls, 'font-mono disabled:opacity-60')}
              />
            </FormField>
          </div>

          <FormField label="Notes">
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Anything the floor should know about this job"
              className={cn(inputCls, 'resize-none')}
            />
          </FormField>
        </div>

        {/* Save sits at the bottom, always visible */}
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-white/12 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-[var(--glass-muted)] hover:text-[var(--glass-ink)] disabled:opacity-40 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium',
              'bg-brand-primary text-white hover:bg-brand-primary/90',
              'disabled:opacity-40 transition-colors',
            )}
          >
            <Save className="w-4 h-4" aria-hidden="true" />
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// Static label above the control — this form is read as a filled-in record,
// so the labels stay put rather than floating on focus.
function FormField({
  label, required, hint, children,
}: {
  label:     string;
  required?: boolean;
  hint?:     string;
  children:  React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--glass-muted)] mb-1.5">
        {label}
        {required && <span className="text-red-300 ml-0.5" aria-hidden="true">*</span>}
        {hint && <span className="ml-1.5 font-normal normal-case tracking-normal opacity-70">— {hint}</span>}
      </span>
      {children}
    </label>
  );
}
