'use client';
// src/components/admin/AddDieModal.tsx
// Entering a die off the Prepress sheet, or correcting one already entered.
//
// The field order is the sheet's column order deliberately: whoever is typing
// is reading across a printed row, and reordering the form would make every
// entry a lookup instead of a straight copy.

import React, { useState, useId } from 'react';
import { Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { ModalShell } from './modals';
import type { Die } from '@/lib/types';

const inputCls = cn(
  'w-full px-3 py-2 rounded-lg text-sm bg-[var(--glass-bg)] border border-[var(--glass-border)]',
  'text-[var(--glass-ink)] placeholder:text-[var(--glass-muted)]',
  'focus:outline-none focus:border-emerald-300/70 focus:bg-white/[0.14]',
  'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
);

type Props = {
  editing?: Die;
  onClose: () => void;
  onSaved: () => void;
};

export default function AddDieModal({ editing, onClose, onSaved }: Props) {
  const titleId = useId();

  const [jobName,  setJobName]  = useState(editing?.job_name ?? '');
  const [length,   setLength]   = useState(editing?.length ?? '');
  const [width,    setWidth]    = useState(editing?.width ?? '');
  const [cylinder, setCylinder] = useState(editing?.cylinder?.toString() ?? '');
  const [material, setMaterial] = useState(editing?.material ?? '');
  const [ups,      setUps]      = useState(editing?.ups?.toString() ?? '');
  const [gap,      setGap]      = useState(editing?.gap ?? '');
  const [corner,   setCorner]   = useState(editing?.corner ?? '');
  const [serialNo, setSerialNo] = useState(editing?.serial_no ?? '');
  // <input type="date"> only speaks yyyy-MM-dd; the column is a DATE, so the
  // stored value already is one.
  const [receivedOn, setReceivedOn] = useState(editing?.die_received_on ?? '');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!jobName.trim()) {
      toast.error('Enter the job this die was cut for');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(editing ? `/api/dies/${editing.id}` : '/api/dies', {
        method:  editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_name:        jobName.trim(),
          length:          length.trim(),
          width:           width.trim(),
          cylinder:        cylinder.trim(),
          material:        material.trim(),
          ups:             ups.trim(),
          gap:             gap.trim(),
          corner:          corner.trim(),
          serial_no:       serialNo.trim(),
          die_received_on: receivedOn,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to save die');
        return;
      }
      toast.success(editing ? 'Die updated' : 'Die added');
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
              {editing ? 'Edit die' : 'Add die'}
            </h2>
            <p className="text-xs text-[var(--glass-muted)] mt-0.5">
              Fields follow the Prepress sheet, left to right
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
            <DieLabel required>Job</DieLabel>
            <input
              value={jobName}
              onChange={(e) => setJobName(e.target.value)}
              placeholder="e.g. DHANUKA TARGA SUPER 250 ML"
              className={inputCls}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <DieLabel>Length</DieLabel>
              <input
                value={length}
                onChange={(e) => setLength(e.target.value)}
                placeholder="e.g. 85"
                className={cn(inputCls, 'font-mono')}
              />
            </div>
            <div>
              <DieLabel>Width</DieLabel>
              <input
                value={width}
                onChange={(e) => setWidth(e.target.value)}
                placeholder="e.g. 60 or 85 x 60"
                className={cn(inputCls, 'font-mono')}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <DieLabel>Cylinder</DieLabel>
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
              <DieLabel>Material</DieLabel>
              <input
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
                placeholder="Optional"
                className={inputCls}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <DieLabel>Ups</DieLabel>
              <input
                type="number"
                inputMode="numeric"
                value={ups}
                onChange={(e) => setUps(e.target.value)}
                placeholder="Labels per revolution"
                className={cn(inputCls, 'font-mono')}
              />
            </div>
            <div>
              <DieLabel>Gap</DieLabel>
              <input
                value={gap}
                onChange={(e) => setGap(e.target.value)}
                placeholder="e.g. 5 MM"
                className={inputCls}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <DieLabel>Corner</DieLabel>
              <input
                value={corner}
                onChange={(e) => setCorner(e.target.value)}
                placeholder="e.g. ROUND, SPECIAL"
                className={inputCls}
              />
            </div>
            <div>
              <DieLabel>Serial no</DieLabel>
              <input
                value={serialNo}
                onChange={(e) => setSerialNo(e.target.value)}
                placeholder="Etched on the die"
                className={cn(inputCls, 'font-mono')}
              />
            </div>
          </div>

          <div>
            <DieLabel>Die received on</DieLabel>
            <input
              type="date"
              value={receivedOn}
              onChange={(e) => setReceivedOn(e.target.value)}
              className={cn(inputCls, 'font-mono')}
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
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add die'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function DieLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--glass-muted)] mb-1.5">
      {children}
      {required && <span className="text-red-300 ml-0.5" aria-hidden="true">*</span>}
    </span>
  );
}
