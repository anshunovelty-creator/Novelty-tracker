'use client';
// src/components/admin/JobsTable.tsx

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cn, sortJobs, type JobSortOption } from '@/lib/utils';
import { JOBS_CHANGED_EVENT, JOBS_FILTER_EVENT, type JobsFilterDetail } from '@/lib/constants/events';
import type { Job, AddJobFormData } from '@/lib/types';
import type { DeptPermissions } from '@/lib/constants/departments';
import JobRow, { JOB_ROW_COLS } from './JobRow';
import JobCard from './JobCard';
import FilterBar from './FilterBar';
import AddJobForm from './AddJobForm';
import { SkeletonRows } from '@/components/ui/Skeleton';

type Props = {
  initialJobs: Job[];
  dept:        DeptPermissions;
};

// Header labels for the desk table. Must stay in the same order — and at the
// same count (JOB_ROW_COLS) — as the <td>s in JobRow.
const JOB_COLUMNS = [
  'Job Card', 'PM / Job', 'Party / PO', 'Type',
  'Dispatch', 'Delivery', 'Status', 'Updated', 'Actions',
] as const;

type DuplicatePrefill = Pick<AddJobFormData,
  'party' | 'pm_code' | 'job_name' | 'label_qty' | 'job_type' | 'notes'
>;

// A stable reference for "no data yet" — `data ?? []` would otherwise hand
// back a fresh array every render, defeating the sortedJobs useMemo below.
const EMPTY_JOBS: Job[] = [];

export default function JobsTable({ initialJobs, dept }: Props) {
  const [search,       setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [urgentOnly,   setUrgentOnly]   = useState(false);
  const [sortBy,       setSortBy]       = useState<JobSortOption>('delivery_asc');
  const [expandedId,   setExpandedId]   = useState<string | null>(null);
  const [prefill,      setPrefill]      = useState<Partial<DuplicatePrefill> | undefined>(undefined);
  const [formKey,      setFormKey]      = useState(0); // increment to reset form

  const queryClient = useQueryClient();

  // Debounced only while typing — status/urgent filters apply immediately.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [search]);

  const jobsQuery = useQuery({
    queryKey: ['jobs', debouncedSearch, statusFilter, urgentOnly],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (statusFilter)    params.set('status', statusFilter);
      if (urgentOnly)      params.set('urgent', 'true');
      const res  = await fetch(`/api/jobs?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load jobs');
      return data.jobs as Job[];
    },
    // Seeds the unfiltered view from the server component's own query, so
    // the very first mount never re-fetches what the server already sent.
    // React Query only uses this when the cache has nothing yet for this
    // exact key — a second visit within the session uses its own cache
    // (kept fresh by onJobUpdated/onJobDeleted below) instead of this prop.
    initialData: !debouncedSearch && !statusFilter && !urgentOnly ? initialJobs : undefined,
  });
  const jobs    = jobsQuery.data ?? EMPTY_JOBS;
  const loading = jobsQuery.isFetching;

  // The machine board advances a job's stage on Start / Complete. It has no
  // way to reach into this list, so it fires an event; every cached
  // filter/search variant is invalidated, not just the one on screen.
  useEffect(() => {
    function onJobsChanged() {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    }
    window.addEventListener(JOBS_CHANGED_EVENT, onJobsChanged);
    return () => window.removeEventListener(JOBS_CHANGED_EVENT, onJobsChanged);
  }, [queryClient]);

  // A dashboard stat was clicked — narrow to the rows behind that number and
  // bring the table into view, since the stat row sits above it.
  const tableRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onFilter(e: Event) {
      const detail = (e as CustomEvent<JobsFilterDetail>).detail;
      if (!detail) return;
      if (detail.status !== undefined) setStatusFilter(detail.status);
      if (detail.urgent !== undefined) setUrgentOnly(detail.urgent);
      tableRef.current?.scrollIntoView({
        behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
          ? 'auto'
          : 'smooth',
        block: 'start',
      });
    }
    window.addEventListener(JOBS_FILTER_EVENT, onFilter);
    return () => window.removeEventListener(JOBS_FILTER_EVENT, onFilter);
  }, []);

  // Display order comes from `sortedJobs` below, so this just needs to swap
  // the updated row in — no need to re-sort `jobs` itself. Applied across
  // every cached filter/search variant, not just the one on screen, so
  // flipping back to a previously-viewed filter still shows the edit.
  function onJobUpdated(updatedJob: Job) {
    queryClient.setQueriesData<Job[]>(
      { queryKey: ['jobs'] },
      (old) => old?.map((j) => (j.id === updatedJob.id ? updatedJob : j))
    );
  }

  function onJobDeleted(jobId: string) {
    queryClient.setQueriesData<Job[]>(
      { queryKey: ['jobs'] },
      (old) => old?.filter((j) => j.id !== jobId)
    );
  }

  const sortedJobs = useMemo(() => sortJobs(jobs, sortBy), [jobs, sortBy]);

  const hasFilters = Boolean(search || statusFilter || urgentOnly);

  function clearFilters() {
    setSearch('');
    setStatusFilter('');
    setUrgentOnly(false);
  }

  // Called by JobDuplicateButton — sets prefill and triggers new form key to open fresh
  function handleDuplicate(data: DuplicatePrefill) {
    setPrefill(data);
    setFormKey((k) => k + 1); // forces AddJobForm to remount with new prefill
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div>
      {/* Toolbar + Add Job Form */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-4">
        <h2 className="text-base font-semibold text-[var(--glass-ink)] pt-2">
          Active Jobs
          {jobs.length > 0 && (
            <span className="ml-2 text-[var(--glass-muted)] font-normal text-sm">({jobs.length})</span>
          )}
        </h2>
        <AddJobForm
          key={formKey}
          dept={dept}
          prefillData={prefill}
          onSuccess={() => {
            setPrefill(undefined);
            queryClient.invalidateQueries({ queryKey: ['jobs'] });
          }}
        />
      </div>

      {/* Filters */}
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        urgentOnly={urgentOnly}
        onUrgentOnlyChange={setUrgentOnly}
        sortBy={sortBy}
        onSortByChange={setSortBy}
      />

      {/* Jobs — cards on phones, table from sm up.
          The table's 900px min-width is 2.4 screens of horizontal scrolling on
          a 375px phone, which buries the Status control. Floor operators get
          the card list instead; see JobCard. */}
      <div ref={tableRef} className="mt-3">
        {loading && (
          <div className="h-1 bg-brand-primary/20 relative overflow-hidden rounded-full mb-3" role="status" aria-label="Loading jobs">
            <div className="loading-bar absolute inset-y-0 left-0 w-2/5 bg-brand-primary" />
          </div>
        )}

        {/* Phone: card list */}
        <div className="sm:hidden">
          {loading && sortedJobs.length === 0 ? (
            <div className="space-y-3" aria-hidden="true">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-xl bg-white border border-black/[0.08] p-4 space-y-3">
                  <div className="h-3 w-24 rounded bg-black/[0.06]" />
                  <div className="h-4 w-2/3 rounded bg-black/[0.06]" />
                  <div className="h-12 w-full rounded-xl bg-black/[0.06]" />
                </div>
              ))}
            </div>
          ) : sortedJobs.length === 0 ? (
            <EmptyState hasFilters={hasFilters} onClearFilters={clearFilters} />
          ) : (
            <ul className="space-y-3">
              {sortedJobs.map((job) => (
                <li key={job.id}>
                  <JobCard
                    job={job}
                    dept={dept}
                    isExpanded={expandedId === job.id}
                    onToggleExpand={() =>
                      setExpandedId((prev) => (prev === job.id ? null : job.id))
                    }
                    onJobUpdated={onJobUpdated}
                    onJobDeleted={onJobDeleted}
                    onDuplicate={handleDuplicate}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Desk: table */}
        <div className="hidden sm:block table-scroll-wrapper rounded-xl glass overflow-hidden">
          <table className="w-full min-w-[1400px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/12">
                {JOB_COLUMNS.map((col) => (
                  <th
                    key={col}
                    scope="col"
                    className={cn(
                      'px-4 py-3 text-left text-[11px] font-semibold text-[var(--glass-muted)]',
                      'uppercase tracking-[0.06em] whitespace-nowrap',
                      col === 'Actions' && 'text-right',
                    )}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && sortedJobs.length === 0 ? (
                <SkeletonRows rows={5} cols={JOB_ROW_COLS} />
              ) : sortedJobs.length === 0 ? (
                <tr>
                  <td colSpan={JOB_ROW_COLS} className="px-4 py-0">
                    <EmptyState hasFilters={hasFilters} onClearFilters={clearFilters} />
                  </td>
                </tr>
              ) : (
                sortedJobs.map((job, i) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    dept={dept}
                    index={i}
                    isExpanded={expandedId === job.id}
                    onToggleExpand={() =>
                      setExpandedId((prev) => (prev === job.id ? null : job.id))
                    }
                    onJobUpdated={onJobUpdated}
                    onJobDeleted={onJobDeleted}
                    onDuplicate={handleDuplicate}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Empty is a state, not a missing table. Filtered-empty offers the way out;
// genuinely-empty points at the one thing to do next.
function EmptyState({
  hasFilters, onClearFilters,
}: {
  hasFilters: boolean;
  onClearFilters: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-4 py-12">
      <p className="text-sm font-medium text-[var(--glass-ink)]">
        {hasFilters ? 'No jobs match your filters.' : 'No active jobs yet.'}
      </p>
      <p className="text-xs text-[var(--glass-muted)] mt-1 max-w-[36ch]">
        {hasFilters
          ? 'Try a different search term, or clear the filters to see every active job.'
          : 'Use “Add Job” above to put the first PO into the pipeline.'}
      </p>
      {hasFilters && (
        <button
          onClick={onClearFilters}
          className={cn(
            'mt-4 inline-flex items-center justify-center min-h-[44px] px-4 rounded-lg',
            'text-xs font-medium border border-black/10 text-[var(--glass-ink)]',
            'hover:bg-black/[0.04] active:bg-black/[0.07] transition-colors',
          )}
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
