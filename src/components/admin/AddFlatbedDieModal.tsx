'use client';
// src/components/admin/AddFlatbedDieModal.tsx
// Entering a flatbed die, or correcting one already entered. Mirrors
// AddDieModal.tsx, minus job/material/cylinder/serial (flatbed dies carry
// no job or material identity) plus Shape. Field order matches how the
// team listed them: Length, Width, UPS, Gap, Corner Radius, Shape,
// Location, Date.

import React, { useState, useId } from 'react';
import { Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { ModalShell } from './modals';
import type { FlatbedDie } from '@/lib/types';

const inputCls = cn(
  'w-full px-3 py-2 rounded-lg text-sm bg-[var(--glass-bg)] border border-[var(--glass-border)]',
  'text-[var(--glass-ink)] placeholder:text-[var(--glass-muted)]',
  'focus:outline-none focus:border-emerald-300/70 focus:bg-white/[0.14]',
  'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
);

type Props = {
  editing?: FlatbedDie;
  onClose: () => void;
  onSaved: () => void;
};

export default function AddFlatbedDieModal({ editing, onClose, onSaved }: Props) {
  const titleId = useId();

  const [length,   setLength]   = useState(editing?.length ?? '');
  const [width,    setWidth]    = useState(editing?.width ?? '');
  const [ups,      setUps]      = useState(editing?.ups?.toString() ?? '');
  const [gap,      setGap]      = useState(editing?.gap ?? '');
  const [corner,   setCorner]   = useState(editing?.corner ?? '');
  const [shape,    setShape]    = useState(editing?.shape ?? '');
  const [location, setLocation] = useState(editing?.location ?? '');
  // <input type="date"> only speaks yyyy-MM-dd; the column is a DATE, so the
  // stored value already is one.
  const [receivedOn, setReceivedOn] = useState(editing?.die_received_on ?? '');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!length.trim())     { toast.error('Enter the length'); return; }
    if (!width.trim())      { toast.error('Enter the width'); return; }
    if (!ups.trim())        { toast.error('Enter the ups'); return; }
    if (!gap.trim())        { toast.error('Enter the gap'); return; }
    if (!corner.trim())     { toast.error('Enter the corner radius'); return; }
    if (!shape.trim())      { toast.error('Enter the shape'); return; }
    if (!location.trim())   { toast.error('Enter the die location'); return; }
    if (!receivedOn.trim()) { toast.error('Enter the date'); return; }

    setSaving(true);
    try {
      const res = await fetch(editing ? `/api/flatbed-dies/${editing.id}` : '/api/flatbed-dies', {
        method:  editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          length:          length.trim(),
          width:           width.trim(),
          ups:             ups.trim(),
          gap:             gap.trim(),
          corner:          corner.trim(),
          shape:           shape.trim(),
          location:        location.trim(),
          die_received_on: receivedOn,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to save flatbed die');
        return;
      }
      toast.success(editing ? 'Flatbed die updated' : 'Flatbed die added');
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
              {editing ? 'Edit flatbed die' : 'Add flatbed die'}
            </h2>
            <p className="text-xs text-[var(--glass-muted)] mt-0.5">
              Length, Width, UPS, Gap, Corner Radius, Shape, Location, Date
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <FlatbedDieLabel required>Length</FlatbedDieLabel>
              <input
                value={length}
                onChange={(e) => setLength(e.target.value)}
                placeholder="e.g. 85"
                className={cn(inputCls, 'font-mono')}
              />
            </div>
            <div>
              <FlatbedDieLabel required>Width</FlatbedDieLabel>
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
              <FlatbedDieLabel required>UPS</FlatbedDieLabel>
              <input
                type="number"
                inputMode="numeric"
                value={ups}
                onChange={(e) => setUps(e.target.value)}
                placeholder="Labels per sheet/stroke"
                className={cn(inputCls, 'font-mono')}
              />
            </div>
            <div>
              <FlatbedDieLabel required>Gap</FlatbedDieLabel>
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
              <FlatbedDieLabel required>Corner radius</FlatbedDieLabel>
              <input
                value={corner}
                onChange={(e) => setCorner(e.target.value)}
                placeholder="e.g. ROUND, SPECIAL"
                className={inputCls}
              />
            </div>
            <div>
              <FlatbedDieLabel required>Shape</FlatbedDieLabel>
              <input
                value={shape}
                onChange={(e) => setShape(e.target.value)}
                placeholder="e.g. RECTANGLE, OVAL"
                className={inputCls}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <FlatbedDieLabel required>Location</FlatbedDieLabel>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Rack / shelf / bay"
                className={inputCls}
              />
            </div>
            <div>
              <FlatbedDieLabel required>Date</FlatbedDieLabel>
              <input
                type="date"
                value={receivedOn}
                onChange={(e) => setReceivedOn(e.target.value)}
                className={cn(inputCls, 'font-mono')}
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
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add flatbed die'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function FlatbedDieLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--glass-muted)] mb-1.5">
      {children}
      {required && <span className="text-red-300 ml-0.5" aria-hidden="true">*</span>}
    </span>
  );
}
