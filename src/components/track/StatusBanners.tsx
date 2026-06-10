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

  // 3. QC remark (only if filled)
  if (job.status === 'Quality Check' && job.qc_remark) {
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
    green: 'bg-green-50 border-green-200 text-green-800',
    amber: 'bg-amber-50 border-amber-200 text-amber-800',
    blue:  'bg-sky-50 border-sky-200 text-sky-800',
    red:   'bg-red-50 border-red-200 text-red-800',
  };

  return (
    <div className={cn('border rounded-xl px-4 py-3 text-sm', styles[color])}>
      <span className="mr-2">{icon}</span>
      {children}
    </div>
  );
}
