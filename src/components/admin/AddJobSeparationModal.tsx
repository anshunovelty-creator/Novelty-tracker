'use client';
// src/components/admin/AddJobSeparationModal.tsx
// Entering a job separation row off the PO, or correcting one already
// entered.
//
// The field order is the sheet's column order deliberately: whoever is
// typing is reading across a printed row, and reordering the form would
// make every entry a lookup instead of a straight copy. Sr. No. and Order
// Value are not inputs — Sr. No. is auto-assigned on add, Order Value is
// derived server-side from quantity × rate.

import React, { useState, useId } from 'react';
import { Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { ModalShell } from './modals';
import type { JobSeparation } from '@/lib/types';

const inputCls = cn(
  'w-full px-3 py-2 rounded-lg text-sm bg-[var(--glass-bg)] border border-[var(--glass-border)]',
  'text-[var(--glass-ink)] placeholder:text-[var(--glass-muted)]',
  'focus:outline-none focus:border-emerald-300/70 focus:bg-white/[0.14]',
  'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
);

type Props = {
  editing?: JobSeparation;
  onClose: () => void;
  onSaved: () => void;
};

export default function AddJobSeparationModal({ editing, onClose, onSaved }: Props) {
  const titleId = useId();

  const [party,        setParty]        = useState(editing?.party ?? '');
  const [poNo,         setPoNo]         = useState(editing?.po_no ?? '');
  // <input type="date"> only speaks yyyy-MM-dd; the column is a DATE, so the
  // stored value already is one.
  const [poDate,       setPoDate]       = useState(editing?.po_date ?? '');
  const [pmCode,       setPmCode]       = useState(editing?.pm_code ?? '');
  const [materialName, setMaterialName] = useState(editing?.material_name ?? '');
  const [quantity,     setQuantity]     = useState(editing?.quantity?.toString() ?? '');
  const [unit,         setUnit]         = useState(editing?.unit ?? '');
  const [jobStatus,    setJobStatus]    = useState(editing?.job_status ?? '');
  const [rate,         setRate]         = useState(editing?.rate?.toString() ?? '');
  const [jcStatus,     setJcStatus]     = useState(editing?.jc_status ?? '');
  const [awSendTo,     setAwSendTo]     = useState(editing?.aw_send_to ?? '');
  const [saving, setSaving] = useState(false);

  const qtyNum  = Number(quantity);
  const rateNum = Number(rate);
  const previewOrderValue =
    quantity.trim() && rate.trim() && Number.isFinite(qtyNum) && Number.isFinite(rateNum)
      ? qtyNum * rateNum
      : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!party.trim())        { toast.error('Enter the party'); return; }
    if (!poNo.trim())         { toast.error('Enter the PO no'); return; }
    if (!materialName.trim()) { toast.error('Enter the material name'); return; }
    if (!quantity.trim())     { toast.error('Enter the quantity'); return; }
    if (!rate.trim())         { toast.error('Enter the rate'); return; }

    setSaving(true);
    try {
      const res = await fetch(editing ? `/api/job-separations/${editing.id}` : '/api/job-separations', {
        method:  editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          party:         party.trim(),
          po_no:         poNo.trim(),
          po_date:       poDate,
          pm_code:       pmCode.trim(),
          material_name: materialName.trim(),
          quantity:      quantity.trim(),
          unit:          unit.trim(),
          job_status:    jobStatus.trim(),
          rate:          rate.trim(),
          jc_status:     jcStatus.trim(),
          aw_send_to:    awSendTo.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to save row');
        return;
      }
      toast.success(editing ? 'Row updated' : 'Row added');
      onSaved();
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell titleId={titleId} onClose={saving ? undefined : onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col max-h-[85vh]">
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-white/12 shrink-0">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-[var(--glass-ink)]">
              {editing ? 'Edit job separation row' : 'Add job separation row'}
            </h2>
            <p className="text-xs text-[var(--glass-muted)] mt-0.5">
              {editing && editing.sr_no
                ? `${editing.sr_no} · fields follow the PO sheet, left to right`
                : 'Sr. No. is assigned automatically · fields follow the PO sheet, left to right'}
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

        <div className="px-5 py-4 overflow-y-auto space-y-4">
          <div>
            <JsLabel required>Party</JsLabel>
            <input
              value={party}
              onChange={(e) => setParty(e.target.value)}
              placeholder="e.g. ARYSTA"
              className={inputCls}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <JsLabel required>PO No</JsLabel>
              <input
                value={poNo}
                onChange={(e) => setPoNo(e.target.value)}
                placeholder="e.g. 5000460185"
                className={cn(inputCls, 'font-mono')}
              />
            </div>
            <div>
              <JsLabel>PO Date</JsLabel>
              <input
                type="date"
                value={poDate}
                onChange={(e) => setPoDate(e.target.value)}
                className={cn(inputCls, 'font-mono')}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <JsLabel>PM Code</JsLabel>
              <input
                value={pmCode}
                onChange={(e) => setPmCode(e.target.value)}
                placeholder="e.g. 2920398"
                className={cn(inputCls, 'font-mono')}
              />
            </div>
            <div>
              <JsLabel required>Material Name</JsLabel>
              <input
                value={materialName}
                onChange={(e) => setMaterialName(e.target.value)}
                placeholder="e.g. KURANTO 525FS 1L LABEL_AR_01"
                className={inputCls}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <JsLabel required>Quantity</JsLabel>
              <input
                type="number"
                inputMode="numeric"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="e.g. 1200"
                className={cn(inputCls, 'font-mono')}
              />
            </div>
            <div>
              <JsLabel>Unit</JsLabel>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className={cn(inputCls, 'font-mono appearance-none')}
              >
                <option value="">Not set</option>
                <option value="1">Unit 1</option>
                <option value="2">Unit 2</option>
                <option value="1&2">Unit 1&2</option>
              </select>
            </div>
          </div>

          <div>
            <JsLabel>Job Status</JsLabel>
            <input
              value={jobStatus}
              onChange={(e) => setJobStatus(e.target.value)}
              placeholder="Optional"
              className={inputCls}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <JsLabel required>Rate</JsLabel>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder="e.g. 22.50"
                className={cn(inputCls, 'font-mono')}
              />
            </div>
            <div>
              <JsLabel>Order Value</JsLabel>
              <p className={cn(inputCls, 'font-mono flex items-center bg-black/[0.03]')}>
                {previewOrderValue !== null
                  ? `₹${previewOrderValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : '—'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <JsLabel>JC Status</JsLabel>
              <input
                value={jcStatus}
                onChange={(e) => setJcStatus(e.target.value)}
                placeholder="e.g. DONE"
                className={inputCls}
              />
            </div>
            <div>
              <JsLabel>AW send to</JsLabel>
              <input
                value={awSendTo}
                onChange={(e) => setAwSendTo(e.target.value)}
                placeholder="e.g. REPEAT"
                className={inputCls}
              />
            </div>
          </div>
        </div>

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
            <Check className="w-4 h-4" aria-hidden="true" />
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add row'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function JsLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--glass-muted)] mb-1.5">
      {children}
      {required && <span className="text-red-300 ml-0.5" aria-hidden="true">*</span>}
    </span>
  );
}
