'use client';
// src/components/admin/AddPlateModal.tsx
// Recording a plate, or correcting one already recorded.
//
// Field order matches the Prepress spreadsheet this replaces, so someone
// copying a row across reads down the form in the same order they read
// across the sheet. Only the party is required — a plate is often entered
// before its serial is etched or its rack decided.

import React, { useState, useId } from 'react';
import { Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { ModalShell } from './modals';
import type { Plate } from '@/lib/types';

const inputCls = cn(
  'w-full px-3 py-2 rounded-lg text-sm bg-[var(--glass-bg)] border border-[var(--glass-border)]',
  'text-[var(--glass-ink)] placeholder:text-[var(--glass-muted)]',
  'focus:outline-none focus:border-emerald-300/70 focus:bg-white/[0.14]',
  'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
);

type Props = {
  editing?: Plate;
  onClose: () => void;
  onSaved: () => void;
};

export default function AddPlateModal({ editing, onClose, onSaved }: Props) {
  const titleId = useId();

  const [party,         setParty]         = useState(editing?.party ?? '');
  const [pmCode,        setPmCode]        = useState(editing?.pm_code ?? '');
  const [itemName,      setItemName]      = useState(editing?.item_name ?? '');
  const [acrossSize,    setAcrossSize]    = useState(editing?.across_size ?? '');
  const [aroundSize,    setAroundSize]    = useState(editing?.around_size ?? '');
  const [cylinder,      setCylinder]      = useState(editing?.cylinder?.toString() ?? '');
  const [plateId,       setPlateId]       = useState(editing?.plate_id ?? '');
  const [plateDate,     setPlateDate]     = useState(editing?.plate_date ?? '');
  const [labelPerRound, setLabelPerRound] = useState(editing?.label_per_round?.toString() ?? '');
  const [location,      setLocation]      = useState(editing?.location ?? '');
  const [saving,        setSaving]        = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!party.trim()) {
      toast.error('Enter the party this plate belongs to');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(editing ? `/api/plates/${editing.id}` : '/api/plates', {
        method:  editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          party:           party.trim(),
          pm_code:         pmCode.trim(),
          item_name:       itemName.trim(),
          across_size:     acrossSize.trim(),
          around_size:     aroundSize.trim(),
          cylinder,
          plate_id:        plateId.trim(),
          plate_date:      plateDate,
          label_per_round: labelPerRound,
          location:        location.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to save plate');
        return;
      }
      toast.success(editing ? 'Plate updated' : 'Plate added');
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
              {editing ? 'Edit plate' : 'Add plate'}
            </h2>
            <p className="text-xs text-[var(--glass-muted)] mt-0.5">
              Only the party is required — fill in the rest as it becomes known
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
            <PlateLabel required>Party</PlateLabel>
            <input
              value={party}
              onChange={(e) => setParty(e.target.value)}
              placeholder="e.g. DHANUKA - SANAND"
              className={inputCls}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <PlateLabel>PM code</PlateLabel>
              <input
                value={pmCode}
                onChange={(e) => setPmCode(e.target.value)}
                placeholder="Optional"
                className={cn(inputCls, 'font-mono')}
              />
            </div>
            <div>
              <PlateLabel>Item name</PlateLabel>
              <input
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                placeholder="Optional"
                className={inputCls}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <PlateLabel>Across size (H)</PlateLabel>
              <input
                value={acrossSize}
                onChange={(e) => setAcrossSize(e.target.value)}
                placeholder="Optional"
                className={cn(inputCls, 'font-mono')}
              />
            </div>
            <div>
              <PlateLabel>Around size (W)</PlateLabel>
              <input
                value={aroundSize}
                onChange={(e) => setAroundSize(e.target.value)}
                placeholder="Optional"
                className={cn(inputCls, 'font-mono')}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <PlateLabel>Cylinder</PlateLabel>
              <input
                type="number"
                inputMode="numeric"
                value={cylinder}
                onChange={(e) => setCylinder(e.target.value)}
                placeholder="Optional"
                className={cn(inputCls, 'font-mono')}
              />
            </div>
            <div>
              <PlateLabel>Plate ID</PlateLabel>
              <input
                value={plateId}
                onChange={(e) => setPlateId(e.target.value)}
                placeholder="Etched serial — optional"
                className={cn(inputCls, 'font-mono')}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <PlateLabel>Plate date</PlateLabel>
              <input
                type="date"
                value={plateDate}
                onChange={(e) => setPlateDate(e.target.value)}
                className={cn(inputCls, 'font-mono')}
              />
            </div>
            <div>
              <PlateLabel>Label per round</PlateLabel>
              <input
                type="number"
                inputMode="numeric"
                value={labelPerRound}
                onChange={(e) => setLabelPerRound(e.target.value)}
                placeholder="Optional"
                className={cn(inputCls, 'font-mono')}
              />
            </div>
          </div>

          <div>
            <PlateLabel>Location</PlateLabel>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Rack / shelf / bay"
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
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add plate'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function PlateLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--glass-muted)] mb-1.5">
      {children}
      {required && <span className="text-red-300 ml-0.5" aria-hidden="true">*</span>}
    </span>
  );
}
