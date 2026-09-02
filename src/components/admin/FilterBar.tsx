'use client';
// src/components/admin/FilterBar.tsx

import { Flame, Search, X } from 'lucide-react';
import { cn, JOB_SORT_OPTIONS, type JobSortOption } from '@/lib/utils';
import { PIPELINE_STAGES } from '@/lib/constants/stages';
import { SelectField } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';

type Props = {
  search:               string;
  onSearchChange:       (v: string) => void;
  statusFilter:         string;
  onStatusFilterChange: (v: string) => void;
  urgentOnly:           boolean;
  onUrgentOnlyChange:   (v: boolean) => void;
  sortBy:               JobSortOption;
  onSortByChange:       (v: JobSortOption) => void;
  onClearFilters:       () => void;
};

export default function FilterBar({
  search, onSearchChange,
  statusFilter, onStatusFilterChange,
  urgentOnly, onUrgentOnlyChange,
  sortBy, onSortByChange,
  onClearFilters,
}: Props) {
  // Which filters are actually narrowing the list right now. Sort order is
  // deliberately excluded — re-ordering rows hides nothing, so offering to
  // "clear" it would misdescribe what the control does.
  const activeFilters = [
    search       && { key: 'search', label: `“${search}”`, clear: () => onSearchChange('') },
    statusFilter && { key: 'status', label: statusFilter,  clear: () => onStatusFilterChange('') },
    urgentOnly   && { key: 'urgent', label: 'Urgent only', clear: () => onUrgentOnlyChange(false) },
  ].filter(Boolean) as { key: string; label: string; clear: () => void }[];

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-2">
        {/* Search.
            Six other admin pages use this icon + placeholder pattern; the
            dashboard used the floating-label Field, which reads as static
            text until it is clicked — on the one page everyone lives on.
            Search and form entry are different jobs, so they no longer share
            a control: the floating label stays for data entry, search gets
            the affordance that says "type here". */}
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--glass-muted)]"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search job card, PM, party, PO…"
            aria-label="Search jobs"
            data-global-search
            className={cn(
              'w-full min-h-11 rounded-xl pl-10 pr-20 text-sm',
              'bg-[var(--field-bg)] border border-[var(--field-border)] text-[var(--glass-ink)]',
              'placeholder:text-[var(--glass-muted)] outline-none transition-all duration-200',
              'hover:border-[var(--field-border-hover)]',
              'focus:border-emerald-300/70 focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)]',
              // The browser's own clear affordance would sit under ours.
              '[&::-webkit-search-cancel-button]:appearance-none',
            )}
          />
          {search ? (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="Clear search"
              className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[var(--glass-muted)] hover:text-[var(--glass-ink)] transition-colors"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : (
            // The Ctrl+K shortcut already worked but was announced only in a
            // title tooltip nobody hovers.
            <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-[var(--field-border)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--glass-muted)] sm:block">
              Ctrl K
            </kbd>
          )}
        </div>

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

        {/* Sort order */}
        <SelectField
          label="Sort By"
          value={sortBy}
          onChange={(e) => onSortByChange(e.target.value as JobSortOption)}
        >
          {JOB_SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </SelectField>

        {/* Urgent filter.
            A toggle, not an action — so when it is on it wears the red of the
            state it is filtering to, and when off it is an ordinary ghost. */}
        <Button
          icon={Flame}
          onClick={() => onUrgentOnlyChange(!urgentOnly)}
          aria-pressed={urgentOnly}
          className={cn(
            urgentOnly && 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100',
          )}
        >
          {urgentOnly ? 'Urgent Only' : 'Urgent'}
        </Button>
      </div>

      {/* Active filters.
          Clearing used to be offered only inside the empty state — filter down
          to three rows and there was no way out but to remember which of four
          controls you had touched. Each chip drops its own filter; the last
          one drops them all. */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--glass-muted)]">
            Filtered by
          </span>
          {activeFilters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={f.clear}
              aria-label={`Remove filter: ${f.label}`}
              className={cn(
                'group inline-flex items-center gap-1 rounded-full py-0.5 pl-2.5 pr-1.5',
                'min-h-0 border border-[var(--field-border)] bg-[var(--glass-bg)]',
                'text-xs font-medium text-[var(--glass-ink)]',
                'hover:border-[var(--field-border-hover)] transition-colors',
              )}
            >
              <span className="max-w-[22ch] truncate">{f.label}</span>
              <X className="h-3 w-3 shrink-0 text-[var(--glass-muted)] group-hover:text-[var(--glass-ink)]" aria-hidden="true" />
            </button>
          ))}
          {activeFilters.length > 1 && (
            <button
              type="button"
              onClick={onClearFilters}
              className="min-h-0 rounded-full px-2 py-0.5 text-xs font-medium text-[var(--glass-muted)] underline-offset-2 hover:text-[var(--glass-ink)] hover:underline transition-colors"
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
