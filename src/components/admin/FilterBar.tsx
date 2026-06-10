'use client';
// src/components/admin/FilterBar.tsx

import { cn } from '@/lib/utils';
import { PIPELINE_STAGES } from '@/lib/constants/stages';

type Props = {
  search:               string;
  onSearchChange:       (v: string) => void;
  statusFilter:         string;
  onStatusFilterChange: (v: string) => void;
  urgentOnly:           boolean;
  onUrgentOnlyChange:   (v: boolean) => void;
};

export default function FilterBar({
  search, onSearchChange,
  statusFilter, onStatusFilterChange,
  urgentOnly, onUrgentOnlyChange,
}: Props) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2">
      {/* Search */}
      <input
        type="search"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search PO number, party, job name…"
        className={cn(
          'px-3 py-2 rounded-lg border text-sm',
          'bg-white border-brand-border text-brand-accent placeholder:text-brand-muted',
          'focus:outline-none focus:ring-2 focus:ring-brand-accent/20 focus:border-brand-accent',
          'transition-colors'
        )}
      />

      {/* Status filter */}
      <select
        value={statusFilter}
        onChange={(e) => onStatusFilterChange(e.target.value)}
        className={cn(
          'px-3 py-2 rounded-lg border text-sm',
          'bg-white border-brand-border text-brand-accent',
          'focus:outline-none focus:ring-2 focus:ring-brand-accent/20 focus:border-brand-accent',
          'transition-colors'
        )}
      >
        <option value="">All Statuses</option>
        {PIPELINE_STAGES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
        <option value="On Hold">On Hold</option>
      </select>

      {/* Urgent filter */}
      <button
        onClick={() => onUrgentOnlyChange(!urgentOnly)}
        className={cn(
          'px-4 py-2 rounded-lg border text-sm font-medium transition-colors',
          urgentOnly
            ? 'bg-red-50 border-red-200 text-red-700'
            : 'bg-white border-brand-border text-brand-muted hover:text-brand-accent'
        )}
      >
        {urgentOnly ? '🔴 Urgent Only' : 'Urgent'}
      </button>
    </div>
  );
}
