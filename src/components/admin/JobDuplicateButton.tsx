'use client';
// src/components/admin/JobDuplicateButton.tsx
// One-click duplication. Copies party, pm_code, job_name, label_qty,
// job_type, notes into the Add Job form. Leaves PO/dates blank.
// Uses a callback pattern — parent (JobRow) holds the form open state.

import React from 'react';
import type { Job } from '@/lib/types';

type Props = {
  job:       Job;
  onDuplicate: (prefill: {
    party:     string;
    pm_code:   string;
    job_name:  string;
    label_qty: number | null;
    job_type:  'New' | 'Repeat' | 'Artwork Changed';
    notes:     string;
  }) => void;
};

export default function JobDuplicateButton({ job, onDuplicate }: Props) {
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

  return (
    <button
      onClick={handleClick}
      title="Duplicate this job"
      className="text-brand-muted hover:text-brand-accent text-xs transition-colors px-2 py-1 border border-brand-border rounded"
    >
      Copy
    </button>
  );
}
