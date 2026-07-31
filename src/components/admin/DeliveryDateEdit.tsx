'use client';
// src/components/admin/DeliveryDateEdit.tsx

import { useState } from 'react';
import { Pencil, Check, X } from 'lucide-react';
import { cn, formatNumericDate, getDeliveryCountdown } from '@/lib/utils';
import type { Department } from '@/lib/constants/departments';
import toast from 'react-hot-toast';

type Props = {
  jobId:        string;
  deliveryDate: string | null;
  dept:         Department;
  onUpdated:    (newDate: string | null) => void;
};

export default function DeliveryDateEdit({ jobId, deliveryDate, dept, onUpdated }: Props) {
  const [editing,  setEditing]  = useState(false);
  const [value,    setValue]    = useState(deliveryDate ?? '');
  const [loading,  setLoading]  = useState(false);

  const canEdit = dept === 'Admin' || dept === 'Dispatch';

  async function handleSave() {
    setLoading(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ delivery_date: value || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to update delivery date');
        return;
      }
      onUpdated(value || null);
      setEditing(false);
      toast.success('Delivery date updated');
    } catch {
      toast.error('Network error');
    } finally {
      setLoading(false);
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Delivery date"
          className={cn(
            'px-2 py-1 rounded-lg border text-xs font-mono bg-white/[0.06] text-[var(--glass-ink)]',
            'border-white/15 focus:outline-none focus:border-emerald-300/70 focus:bg-white/[0.14]',
            'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all [color-scheme:dark]',
          )}
          autoFocus
        />
        <button
          onClick={handleSave}
          disabled={loading}
          aria-label="Save delivery date"
          className="p-1 rounded text-emerald-200 hover:bg-emerald-400/15 disabled:opacity-50 transition-colors"
        >
          <Check className="w-4 h-4" aria-hidden="true" />
        </button>
        <button
          onClick={() => { setEditing(false); setValue(deliveryDate ?? ''); }}
          aria-label="Cancel editing delivery date"
          className="p-1 rounded text-[var(--glass-muted)] hover:text-[var(--glass-ink)] hover:bg-white/10 transition-colors"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    );
  }

  // A delivery date is only worth reading if you can see it slipping, so the
  // date itself carries the countdown state instead of an extra line of text.
  const countdown = getDeliveryCountdown(deliveryDate);
  const dateTone =
    !deliveryDate                 ? 'text-[var(--glass-muted)]'
    : countdown.color === 'red'   ? 'text-red-600 font-semibold'
    : countdown.color === 'amber' ? 'text-amber-700 font-semibold'
    : 'text-[var(--glass-ink)]';

  return (
    <div className="flex items-center gap-1">
      <span
        className={cn('font-mono text-xs', dateTone)}
        title={deliveryDate ? countdown.label : undefined}
      >
        {deliveryDate ? formatNumericDate(deliveryDate) : 'Not set'}
      </span>
      {canEdit && (
        <button
          onClick={() => setEditing(true)}
          aria-label="Edit delivery date"
          title="Edit delivery date"
          className={cn(
            'p-1 rounded text-[var(--glass-muted)] hover:text-[var(--glass-ink)] hover:bg-white/10 transition-colors',
            // Visible by default on touch/keyboard; recedes to subtle on hover-capable pointers
            'opacity-70 focus-visible:opacity-100 md:opacity-40 md:group-hover:opacity-100 md:focus-visible:opacity-100',
          )}
        >
          <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
