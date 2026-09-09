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
import AddJobForm, { type AddJobFormHandle } from './AddJobForm';
import { SkeletonRows } from '@/components/ui/Skeleton';

type Props = {
  initialJobs: Job[];
  dept:        DeptPermissions;
  // Set together by the dashboard toolbar, which owns the visible "Add Job"
  // button now: hideAddTrigger suppresses this form's own "+ Add Job"
  // button while closed, and addJobFormRef lets that external button open
  // it. Neither is passed elsewhere (e.g. if JobsTable ever gained another
  // caller without a toolbar), so the form's own trigger is the default.
  addJobFormRef?:  React.Ref<AddJobFormHandle>;
  hideAddTrigger?: boolean;
  // Rendered on the right of the "Active Jobs" heading row — the dashboard
  // toolbar (Manage Printing Units / Show-Hide Machine Board / Add Job)
  // lives here instead of its own row, since this heading row already has
  // the vertical space to spare.
  toolbarExtra?: React.ReactNode;
};

// Header labels for the desk table. Must stay in the same order — and at the
// same count (JOB_ROW_COLS) — as the <td>s in JobRow.
const JOB_COLUMNS = [
  'Job Card / PO Dt', 'PM / Job', 'Party / PO',
  'Dispatch', 'Delivery', 'Status', 'Actions',
] as const;

type DuplicatePrefill = Pick<AddJobFormData,
  'party' | 'pm_code' | 'job_name' | 'label_qty' | 'job_type' | 'notes'
>;

// A stable reference for "no data yet" — `data ?? []` would otherwise hand
// back a fresh array every render, defeating the sortedJobs useMemo below.
const EMPTY_JOBS: Job[] = [];

export default function JobsTable({ initialJobs, dept, addJobFormRef, hideAddTrigger, toolbarExtra }: Props) {
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
      {/* Heading + dashboard toolbar, on one row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        {/* The count used to read "Active Jobs (3)" whether that was every job
            or three survivors of a filter — the same number silently meaning
            two different things, which on a production tracker is a genuinely
            misleading thing to read at a glance. It now says which it is. */}
        <h2 className="text-base font-semibold text-[var(--glass-ink)]">
          Active Jobs
          {jobs.length > 0 && (
            <span className="ml-2 font-normal text-sm text-[var(--glass-muted)]">
              {hasFilters
                ? `— ${jobs.length} matching`
                : `(${jobs.length})`}
            </span>
          )}
        </h2>
        {toolbarExtra}
      </div>

      {/* Add Job form — a block of its own below the heading row rather than
          a flex sibling next to it, since the expanded panel is far wider
          than anything that row's height was sized for. Contributes nothing
          when closed (hideAddTrigger callers get null; the default trigger
          button is small enough to sit here too). */}
      <AddJobForm
        key={formKey}
        ref={addJobFormRef}
        hideTrigger={hideAddTrigger}
        dept={dept}
        prefillData={prefill}
        onSuccess={() => {
          setPrefill(undefined);
          queryClient.invalidateQueries({ queryKey: ['jobs'] });
        }}
      />

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
        onClearFilters={clearFilters}
      />

      {/* Jobs — cards below lg, table from lg up.
          The table is 1400px wide, so anything narrower scrolls sideways to
          reach Status and Actions. The switch used to sit at sm (640px),
          which handed the full-width table to every tablet on the floor —
          2.2 screens of horizontal scrolling on a 768px screen. Cards now
          cover phones and tablets both; see JobCard. */}
      <div ref={tableRef} className="mt-3">
        {loading && (
          <div className="h-1 bg-brand-primary/20 relative overflow-hidden rounded-full mb-3" role="status" aria-label="Loading jobs">
            <div className="loading-bar absolute inset-y-0 left-0 w-2/5 bg-brand-primary" />
          </div>
        )}

        {/* Phone + tablet: card list */}
        <div className="lg:hidden">
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

        {/* Desk: table.
            The scroll region is bounded (max-h) so `position: sticky` has a
            scrollport to stick to — without a height limit the wrapper is as
            tall as its content and a sticky thead never actually pins. Same
            arrangement DiesManager and JobSeparationManager already use.
            Column widths are floors (min-w), not fixed — same convention as
            the Job Separation table: the browser shrinks columns and wraps
            their text down to those floors first, and only once the whole
            row can't get any narrower does min-w-[1000px] below force the
            horizontal scrollbar. The header row and the Job Card cell both
            stay pinned through that scroll, so reaching Actions never costs
            sight of which job you're acting on. */}
        <div className="hidden lg:block rounded-xl glass overflow-hidden">
          <div className="table-scroll-wrapper max-h-[72vh] overflow-y-auto">
          <table className="w-full min-w-[1000px] border-collapse text-sm">
            <thead>
              <tr>
                {JOB_COLUMNS.map((col) => (
                  <th
                    key={col}
                    scope="col"
                    className={cn(
                      'sticky top-0 z-10 px-3 py-1.5 text-left text-[11px] font-semibold text-[var(--glass-muted)]',
                      'uppercase tracking-[0.06em] whitespace-nowrap',
                      'bg-[var(--glass-bg-strong)] backdrop-blur-[14px] border-b border-white/12',
                      // A thin vertical rule between every column but the last —
                      // same convention as the Job Separation table, so the eye
                      // has a fixed lane to track across a wide row.
                      col !== 'Actions' && col !== 'Job Card / PO Dt' && 'border-r border-white/8',
                      // Job Card is the row's identity — it pins left as well,
                      // above its peers so the two sticky axes don't fight.
                      col === 'Job Card / PO Dt' && 'left-0 z-20 border-r border-white/12',
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
