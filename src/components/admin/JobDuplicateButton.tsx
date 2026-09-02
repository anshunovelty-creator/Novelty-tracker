'use client';
// src/components/admin/JobDuplicateButton.tsx
// One-click duplication. Copies party, pm_code, job_name, label_qty,
// job_type, notes into the Add Job form. Leaves PO/dates blank.
// Uses a callback pattern — parent (JobRow) holds the form open state.

import React from 'react';
import { Copy } from 'lucide-react';
import type { Job } from '@/lib/types';
import { Button } from '@/components/ui/Button';

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

  // 'touch' maps to the md size, which already carries the 44px minimum
  // PRODUCT.md asks for on the card surface; 'compact' is the in-row sm.
  return (
    <Button
      size={size === 'touch' ? 'md' : 'sm'}
      icon={Copy}
      onClick={handleClick}
      title="Duplicate this job"
      aria-label="Duplicate this job"
    >
      Duplicate
    </Button>
  );
}
