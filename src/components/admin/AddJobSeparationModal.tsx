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

import React, { useState, useEffect, useRef, useId } from 'react';
import { Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { ModalShell } from './modals';
import type { JobSeparation, Party } from '@/lib/types';

const inputCls = cn(
  'w-full px-3 py-2 rounded-lg text-sm bg-[var(--glass-bg)] border border-[var(--glass-border)]',
  'text-[var(--glass-ink)] placeholder:text-[var(--glass-muted)]',
  'focus:outline-none focus:border-emerald-300/70 focus:bg-white/[0.14]',
  'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
);

type Props = {
  editing?: JobSeparation;
  // Seeds the form from an existing row without editing it — "Duplicate"
  // opens a fresh Add form (POST) pre-filled with these values instead of
  // a PATCH to the source row. Ignored when `editing` is set.
  prefill?: JobSeparation;
  onClose: () => void;
  onSaved: () => void;
};

export default function AddJobSeparationModal({ editing, prefill, onClose, onSaved }: Props) {
  const titleId = useId();
  const seed = editing ?? prefill;

  const [party,        setParty]        = useState(seed?.party ?? '');
  // A row being edited (or duplicated from) already has a real, saved
  // party — that counts as confirmed. New entries start unconfirmed until
  // a suggestion is picked, so a stray typo can never reach the database
  // as if it were a deliberate new party. Adding a party that isn't on the
  // list yet happens only through the separate Parties manager
  // (JobSeparationManager's "Parties" button) — not inline here.
  const [partyConfirmed,     setPartyConfirmed]     = useState(Boolean(seed?.party));
  const [partySuggestions,   setPartySuggestions]   = useState<Party[]>([]);
  const [showPartySuggestions, setShowPartySuggestions] = useState(false);
  // Set right after picking a suggestion so the lookup effect doesn't
  // immediately re-open the dropdown for the value it just wrote —
  // mirrors suppressPmLookup in AddJobForm.tsx.
  const suppressPartyLookup = useRef(false);
  const [poNo,         setPoNo]         = useState(seed?.po_no ?? '');
  // <input type="date"> only speaks yyyy-MM-dd; the column is a DATE, so the
  // stored value already is one.
  const [poDate,       setPoDate]       = useState(seed?.po_date ?? '');
  const [pmCode,       setPmCode]       = useState(seed?.pm_code ?? '');
  const [materialName, setMaterialName] = useState(seed?.material_name ?? '');
  const [quantity,     setQuantity]     = useState(seed?.quantity?.toString() ?? '');
  const [unit,         setUnit]         = useState(seed?.unit ?? '');
  const [jobStatus,    setJobStatus]    = useState(seed?.job_status ?? '');
  const [rate,         setRate]         = useState(seed?.rate?.toString() ?? '');
  const [jcStatus,     setJcStatus]     = useState(seed?.jc_status ?? '');
  const [awSendTo,     setAwSendTo]     = useState(seed?.aw_send_to ?? '');
  const [saving, setSaving] = useState(false);

  const qtyNum  = Number(quantity);
  const rateNum = Number(rate);
  const previewOrderValue =
    quantity.trim() && rate.trim() && Number.isFinite(qtyNum) && Number.isFinite(rateNum)
      ? qtyNum * rateNum
      : null;

  // Party typeahead — searches the master list as soon as the first
  // letter is typed (min length 1, unlike the PM-code lookup's min of 2,
  // per how the team wants to search this field).
  useEffect(() => {
    if (suppressPartyLookup.current) {
      suppressPartyLookup.current = false;
      return;
    }
    const q = party.trim();
    if (!q) {
      setPartySuggestions([]);
      setShowPartySuggestions(false);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res  = await fetch(`/api/parties?search=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (res.ok) {
          setPartySuggestions(data.parties ?? []);
          setShowPartySuggestions(true);
        }
      } catch {
        // Best-effort — the confirmed-party validation below still guards
        // submission without it.
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [party]);

  function selectParty(p: Party) {
    suppressPartyLookup.current = true;
    setParty(p.name);
    setPartyConfirmed(true);
    setShowPartySuggestions(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!party.trim())        { toast.error('Enter the party'); return; }
    if (!partyConfirmed) {
      toast.error('Select a party from the list — add new parties from the Parties button');
      return;
    }
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
                : prefill
                  ? `Duplicated from ${prefill.sr_no ?? 'previous row'} · Sr. No. is assigned automatically`
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
            <div className="relative">
              <input
                value={party}
                onChange={(e) => { setParty(e.target.value); setPartyConfirmed(false); }}
                onFocus={() => (partySuggestions.length > 0 || party.trim()) && setShowPartySuggestions(true)}
                onBlur={() => setTimeout(() => setShowPartySuggestions(false), 150)}
                placeholder="Start typing to search the party list…"
                autoComplete="off"
                className={inputCls}
              />
              {showPartySuggestions && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 glass-strong glass rounded-lg shadow-lg overflow-hidden max-h-56 overflow-y-auto">
                  {partySuggestions.length > 0 ? (
                    partySuggestions.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        // onMouseDown fires before the input's onBlur closes the list
                        onMouseDown={(e) => { e.preventDefault(); selectParty(p); }}
                        className="w-full text-left px-3 py-2 text-sm text-[var(--glass-ink)] hover:bg-white/[0.08] transition-colors border-b border-white/10 last:border-0"
                      >
                        {p.name}
                      </button>
                    ))
                  ) : (
                    <p className="px-3 py-2 text-xs text-[var(--glass-muted)]">
                      No matching party. Add it from the Parties button on the toolbar first.
                    </p>
                  )}
                </div>
              )}
            </div>
            {!partyConfirmed && party.trim() && !showPartySuggestions && (
              <p className="text-xs text-amber-200 mt-1">
                Select this party from the list — add new parties from the Parties button.
              </p>
            )}
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
                  ? previewOrderValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })
                  : '—'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <JsLabel>JC Status</JsLabel>
              <input
                value={jcStatus}
                onChange={(e) => setJcStatus(e.target.value.toUpperCase())}
                placeholder="e.g. DONE"
                className={inputCls}
              />
            </div>
            <div>
              <JsLabel>AW send to</JsLabel>
              <input
                value={awSendTo}
                onChange={(e) => setAwSendTo(e.target.value.toUpperCase())}
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
