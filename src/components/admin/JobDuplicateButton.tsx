'use client';
// src/components/admin/JobDuplicateButton.tsx
// One-click duplication. Copies party, pm_code, job_name, label_qty,
// job_type, notes into the Add Job form. Leaves PO/dates blank.
// Uses a callback pattern — parent (JobRow) holds the form open state.

import React from 'react';
import { Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Job } from '@/lib/types';

type Props = {
  job:       Job;
  /**
   * 'compact' — the dense desk table, where the row already carries the target.
   * 'touch'   — the phone card, where PRODUCT.md mandates a 44px tap target.
   */
  size?:     'compact' | 'touch';
  onDuplicate: (prefill: {
    party:     string;
    pm_code:   string;
    job_name:  string;
    label_qty: number | null;
    job_type:  'New' | 'Repeat' | 'Artwork Changed';
    notes:     string;
  }) => void;
};

export default function JobDuplicateButton({ job, onDuplicate, size = 'compact' }: Props) {
  function handleClick() {
    onDuplicate({
      party:     job.party,
      pm_code:   job.pm_code   ?? '',
      job_name:  job.job_name  ?? '',
      label_qty: job.label_qty ?? null,
      job_type:  job.job_type  as 'New' | 'Repeat' | 'Artwork Changed',
      notes:     job.notes     ?? '',
    });
  }

  if (size === 'touch') {
    return (
      <button
        onClick={handleClick}
        aria-label="Duplicate this job"
        className={cn(
          'inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-lg',
          'text-xs font-medium border border-black/10 text-[var(--glass-ink)]',
          'hover:bg-black/[0.04] active:bg-black/[0.07] transition-colors',
        )}
      >
        <Copy className="w-3.5 h-3.5" aria-hidden="true" />
        Duplicate
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      title="Duplicate this job"
      aria-label="Duplicate this job"
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md',
        'bg-white border border-white/15 text-[var(--glass-ink)]',
        'hover:bg-black/[0.04] transition-colors whitespace-nowrap',
      )}
    >
      <Copy className="w-3.5 h-3.5" aria-hidden="true" />
      Duplicate
    </button>
  );
}
