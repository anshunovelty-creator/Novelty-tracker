'use client';
// src/components/admin/DashboardSummaryCard.tsx

import { cn, formatQty } from '@/lib/utils';
import type { DashboardSummary } from '@/lib/types';

type Props = {
  summary: DashboardSummary | null;
};

export default function DashboardSummaryCard({ summary }: Props) {
  const stats = [
    {
      label:  'Active Jobs',
      value:  summary?.total_active ?? '—',
      color:  'text-brand-accent',
    },
    {
      label:  'On Hold',
      value:  summary?.on_hold_count ?? '—',
      color:  'text-amber-600',
    },
    {
      label:  'Due This Week',
      value:  summary?.due_this_week ?? '—',
      color:  'text-blue-600',
    },
    {
      label:  'Dispatched This Month',
      value:  summary?.dispatched_this_month ?? '—',
      color:  'text-green-600',
    },
    {
      label:  'On-Time Delivery',
      value:  summary?.on_time_delivery_rate != null
                ? `${summary.on_time_delivery_rate}%`
                : '—',
      color:  'text-brand-accent',
      sub:    'this month',
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="bg-white rounded-xl border border-brand-border px-4 py-4"
        >
          <p className="text-xs text-brand-muted font-medium mb-1">{stat.label}</p>
          <p className={cn('text-2xl font-semibold font-mono tabular-nums', stat.color)}>
            {stat.value}
          </p>
          {stat.sub && (
            <p className="text-xs text-brand-muted mt-0.5">{stat.sub}</p>
          )}
        </div>
      ))}
    </div>
  );
}
