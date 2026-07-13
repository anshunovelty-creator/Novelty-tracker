'use client';
// src/components/admin/FilterBar.tsx

import { Flame } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PIPELINE_STAGES } from '@/lib/constants/stages';
import { Field, SelectField } from '@/components/ui/Field';

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
      <Field
        label="Search"
        type="search"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
      />

      {/* Status filter */}
      <SelectField
        label="Status"
        value={statusFilter}
        onChange={(e) => onStatusFilterChange(e.target.value)}
      >
        <option value="">All Statuses</option>
        {PIPELINE_STAGES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
        <option value="On Hold">On Hold</option>
      </SelectField>

      {/* Urgent filter */}
      <button
        onClick={() => onUrgentOnlyChange(!urgentOnly)}
        aria-pressed={urgentOnly}
        className={cn(
          'inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg border text-sm font-medium transition-colors',
          urgentOnly
            ? 'bg-red-50 border-red-200 text-red-700'
            : 'glass text-[var(--glass-muted)] hover:text-[var(--glass-ink)]'
        )}
      >
        <Flame className="w-4 h-4" aria-hidden="true" />
        {urgentOnly ? 'Urgent Only' : 'Urgent'}
      </button>
    </div>
  );
}
