'use client';
// src/components/admin/AddCustomDispatchModal.tsx
// Add a free-text dispatch entry (no job link — for anything that skipped
// the normal Job Separation flow), or edit/correct any queued entry
// already in the list. Both cases queue/update a row in
// pending_dispatch_notifications and ride the same consolidated per-party
// send as every other entry.

import React, { useState, useEffect, useId } from 'react';
import { Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { ModalShell } from './modals';
import type { Party, PendingDispatchNotification } from '@/lib/types';

const inputCls = cn(
  'w-full px-3 py-2 rounded-lg text-sm bg-[var(--glass-bg)] border border-[var(--glass-border)]',
  'text-[var(--glass-ink)] placeholder:text-[var(--glass-muted)]',
  'focus:outline-none focus:border-emerald-300/70 focus:bg-white/[0.14]',
  'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
);

type Props = {
  existing: PendingDispatchNotification | null;
  onClose:  () => void;
  onSaved:  () => void;
};

export default function AddCustomDispatchModal({ existing, onClose, onSaved }: Props) {
  const titleId = useId();

  const [parties,   setParties]   = useState<Party[]>([]);
  const [party,      setParty]      = useState(existing?.party ?? '');
  const [poNumber,   setPoNumber]   = useState(existing?.po_number ?? '');
  const [jobName,    setJobName]    = useState(existing?.job_name ?? '');
  const [status,     setStatus]     = useState<'Dispatched' | 'Partial Dispatch'>(
    (existing?.status as 'Dispatched' | 'Partial Dispatch') ?? 'Dispatched',
  );
  const [qty,        setQty]        = useState(existing?.qty != null ? String(existing.qty) : '');
  const [remark,     setRemark]     = useState(existing?.remark ?? '');
  const [pmCode,     setPmCode]     = useState(existing?.pm_code ?? '');
  const [saving,     setSaving]     = useState(false);

  useEffect(() => {
    fetch('/api/parties')
      .then((res) => res.json())
      .then((data) => setParties(data.parties ?? []))
      .catch(() => toast.error('Failed to load the parties list'));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!party.trim())    { toast.error('Choose a party'); return; }
    if (!poNumber.trim()) { toast.error('Enter a PO number'); return; }

    setSaving(true);
    try {
      const res = await fetch(
        existing ? `/api/dispatch-notifications/${existing.id}` : '/api/dispatch-notifications',
        {
          method:  existing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            party:     party.trim(),
            po_number: poNumber.trim(),
            job_name:  jobName.trim() || undefined,
            status,
            qty:       qty.trim() ? Number(qty) : undefined,
            remark:    remark.trim() || undefined,
            pm_code:   pmCode.trim() || undefined,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? `Failed to ${existing ? 'save' : 'add'} entry`);
        return;
      }
      toast.success(existing ? 'Entry updated' : 'Added — it will go out in the next email for this party');
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
              {existing ? 'Edit dispatch entry' : 'Add custom dispatch entry'}
            </h2>
            <p className="text-xs text-[var(--glass-muted)] mt-0.5">
              {existing
                ? 'Only affects what gets emailed — nothing on the job itself changes'
                : 'For a dispatch that happened outside the system — no job record needed'}
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
            <FieldLabel required>Party</FieldLabel>
            <select
              value={party}
              onChange={(e) => setParty(e.target.value)}
              className={cn(inputCls, 'appearance-none')}
            >
              <option value="" disabled>Choose a party</option>
              {parties.map((p) => (
                <option key={p.id} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <FieldLabel required>PO number</FieldLabel>
            <input
              type="text"
              value={poNumber}
              onChange={(e) => setPoNumber(e.target.value)}
              placeholder="e.g. PO-1234"
              autoComplete="off"
              className={inputCls}
            />
          </div>

          <div>
            <FieldLabel>Job name</FieldLabel>
            <input
              type="text"
              value={jobName}
              onChange={(e) => setJobName(e.target.value)}
              placeholder="Optional"
              autoComplete="off"
              className={inputCls}
            />
          </div>

          <div>
            <FieldLabel>PM code</FieldLabel>
            <input
              type="text"
              value={pmCode}
              onChange={(e) => setPmCode(e.target.value)}
              placeholder="Optional"
              autoComplete="off"
              className={cn(inputCls, 'font-mono')}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel required>Status</FieldLabel>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'Dispatched' | 'Partial Dispatch')}
                className={cn(inputCls, 'appearance-none')}
              >
                <option value="Dispatched">Dispatched</option>
                <option value="Partial Dispatch">Partial Dispatch</option>
              </select>
            </div>
            <div>
              <FieldLabel>Qty</FieldLabel>
              <input
                type="number"
                min="0"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="Optional"
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <FieldLabel>Remark</FieldLabel>
            <input
              type="text"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="Optional — e.g. why this is manual"
              autoComplete="off"
              className={inputCls}
            />
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
            {saving ? 'Saving…' : existing ? 'Save changes' : 'Add entry'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--glass-muted)] mb-1.5">
      {children}
      {required && <span className="text-red-300 ml-0.5" aria-hidden="true">*</span>}
    </span>
  );
}
