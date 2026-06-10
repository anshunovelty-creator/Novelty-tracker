'use client';
// src/components/admin/DeliveryDateEdit.tsx

import { useState } from 'react';
import { cn, formatShortDate } from '@/lib/utils';
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
          className={cn(
            'px-2 py-1 rounded border text-xs font-mono',
            'border-brand-border focus:outline-none focus:ring-1 focus:ring-brand-accent/30'
          )}
          autoFocus
        />
        <button
          onClick={handleSave}
          disabled={loading}
          className="text-green-600 text-xs hover:text-green-700 disabled:opacity-50"
        >
          ✓
        </button>
        <button
          onClick={() => { setEditing(false); setValue(deliveryDate ?? ''); }}
          className="text-brand-muted text-xs hover:text-brand-accent"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 group">
      <span className="font-mono text-xs text-brand-accent">
        {deliveryDate ? formatShortDate(deliveryDate) : <span className="text-brand-muted">—</span>}
      </span>
      {canEdit && (
        <button
          onClick={() => setEditing(true)}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-brand-muted hover:text-brand-accent text-xs ml-0.5"
          title="Edit delivery date"
        >
          ✏
        </button>
      )}
    </div>
  );
}
