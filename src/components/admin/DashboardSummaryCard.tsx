'use client';
// src/components/admin/DashboardSummaryCard.tsx

import { cn } from '@/lib/utils';
import { JOBS_FILTER_EVENT, type JobsFilterDetail } from '@/lib/constants/events';
import type { DashboardSummary } from '@/lib/types';

type Props = {
  summary: DashboardSummary | null;
};

type Stat = {
  label:  string;
  value:  string | number;
  color:  string;
  sub?:   string;
  /** Present only when this number maps onto a filter the table supports. */
  filter?: JobsFilterDetail;
  /** Spoken affordance for the button form. */
  action?: string;
};

export default function DashboardSummaryCard({ summary }: Props) {
  const stats: Stat[] = [
    {
      label:  'Active Jobs',
      value:  summary?.total_active ?? '—',
      color:  'text-[var(--glass-ink)]',
      filter: { status: '', urgent: false },
      action: 'Show all active jobs',
    },
    {
      label:  'On Hold',
      value:  summary?.on_hold_count ?? '—',
      color:  'text-amber-600',
      filter: { status: 'On Hold' },
      action: 'Show jobs on hold',
    },
    {
      label:  'Due This Week',
      value:  summary?.due_this_week ?? '—',
      color:  'text-sky-600',
    },
    {
      label:  'Dispatched This Month',
      value:  summary?.dispatched_this_month ?? '—',
      color:  'text-emerald-600',
    },
    {
      label:  'On-Time Delivery',
      value:  summary?.on_time_delivery_rate != null
                ? `${summary.on_time_delivery_rate}%`
                : '—',
      color:  'text-[var(--glass-ink)]',
      sub:    'this month',
    },
  ];

  function applyFilter(filter: JobsFilterDetail) {
    window.dispatchEvent(
      new CustomEvent<JobsFilterDetail>(JOBS_FILTER_EVENT, { detail: filter }),
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {stats.map((stat) => {
        const body = (
          <>
            <p className="text-xs text-[var(--glass-muted)] font-medium mb-1">
              {stat.label}
            </p>
            <p className={cn('text-2xl font-semibold font-mono tabular-nums', stat.color)}>
              {stat.value}
            </p>
            {stat.sub && (
              <p className="text-xs text-[var(--glass-muted)] mt-0.5">{stat.sub}</p>
            )}
          </>
        );

        // Only the two stats backed by a real filter become controls. Making
        // all five look clickable would promise a drill-down that three of
        // them cannot honour — those describe closed or historical jobs the
        // active table does not contain.
        return stat.filter ? (
          <button
            key={stat.label}
            type="button"
            onClick={() => applyFilter(stat.filter!)}
            aria-label={`${stat.label}: ${stat.value}. ${stat.action}`}
            className="glass rounded-xl px-4 py-4 text-left transition-colors hover:bg-white/10"
          >
            {body}
          </button>
        ) : (
          <div key={stat.label} className="glass rounded-xl px-4 py-4">
            {body}
          </div>
        );
      })}
    </div>
  );
}
