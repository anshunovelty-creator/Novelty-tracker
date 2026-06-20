'use client';
// src/components/track/StatusBanners.tsx
// Banners shown at the top of the client job detail view.
// Priority order (top to bottom): Closed → On Hold → QC remark → Urgent

import React from 'react';
import { cn } from '@/lib/utils';

type Props = {
  job: {
    status:         string;
    is_closed:      boolean;
    halt_remark:    string | null;
    qc_remark:      string | null;
    urgent:         boolean;
    urgent_priority: number | null;
  };
};

export default function StatusBanners({ job }: Props) {
  const banners: React.ReactNode[] = [];

  // 1. Closed
  if (job.is_closed) {
    banners.push(
      <Banner key="closed" color="green" icon="✅">
        <strong>PO Closed</strong> — All quantities delivered.
      </Banner>
    );
  }

  // 2. On Hold
  if (job.status === 'On Hold') {
    banners.push(
      <Banner key="hold" color="amber" icon="⏸">
        <strong>Production On Hold</strong>
        {job.halt_remark && (
          <span className="block text-sm mt-0.5 opacity-80">{job.halt_remark}</span>
        )}
      </Banner>
    );
  }

  // 3. QC remark — show whenever a note exists, not just while in QC stage
  if (!job.is_closed && job.qc_remark) {
    banners.push(
      <Banner key="qc" color="blue" icon="🔬">
        <strong>Quality Check Note</strong>
        <span className="block text-sm mt-0.5 opacity-80">{job.qc_remark}</span>
      </Banner>
    );
  }

  // 4. Urgent (hidden once closed)
  if (job.urgent && !job.is_closed) {
    banners.push(
      <Banner key="urgent" color="red" icon="🔴">
        <strong>Priority Order</strong>
        {job.urgent_priority && (
          <span className="ml-1 text-sm opacity-80">— Priority {job.urgent_priority}</span>
        )}
      </Banner>
    );
  }

  if (banners.length === 0) return null;

  return <div className="space-y-2">{banners}</div>;
}

function Banner({
  color,
  icon,
  children,
}: {
  color:    'green' | 'amber' | 'blue' | 'red';
  icon:     string;
  children: React.ReactNode;
}) {
  const styles = {
    green: 'bg-emerald-400/12 border-emerald-300/25 text-emerald-100',
    amber: 'bg-amber-400/12 border-amber-300/25 text-amber-100',
    blue:  'bg-sky-400/12 border-sky-300/25 text-sky-100',
    red:   'bg-red-400/12 border-red-300/25 text-red-100',
  };

  return (
    <div className={cn('border rounded-xl px-4 py-3 text-sm', styles[color])}>
      <span className="mr-2">{icon}</span>
      {children}
    </div>
  );
}
