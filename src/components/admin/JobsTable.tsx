'use client';
// src/components/admin/JobsTable.tsx

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { JOBS_CHANGED_EVENT, JOBS_FILTER_EVENT, type JobsFilterDetail } from '@/lib/constants/events';
import type { Job, AddJobFormData } from '@/lib/types';
import type { Department } from '@/lib/constants/departments';
import JobRow from './JobRow';
import JobCard from './JobCard';
import FilterBar from './FilterBar';
import AddJobForm from './AddJobForm';
import { SkeletonRows } from '@/components/ui/Skeleton';

type Props = {
  initialJobs: Job[];
  dept:        Department;
};

type DuplicatePrefill = Pick<AddJobFormData,
  'party' | 'pm_code' | 'job_name' | 'label_qty' | 'job_type' | 'notes'
>;

export default function JobsTable({ initialJobs, dept }: Props) {
  const [jobs,         setJobs]         = useState<Job[]>(initialJobs);
  const [loading,      setLoading]      = useState(false);
  const [search,       setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [urgentOnly,   setUrgentOnly]   = useState(false);
  const [expandedId,   setExpandedId]   = useState<string | null>(null);
  const [prefill,      setPrefill]      = useState<Partial<DuplicatePrefill> | undefined>(undefined);
  const [formKey,      setFormKey]      = useState(0); // increment to reset form

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search)       params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      if (urgentOnly)   params.set('urgent', 'true');
      const res  = await fetch(`/api/jobs?${params.toString()}`);
      const data = await res.json();
      if (res.ok) setJobs(data.jobs);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, urgentOnly]);

  // The server already provided initialJobs; skip the redundant fetch on mount
  // unless a filter is somehow active on first render.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      if (!search && !statusFilter && !urgentOnly) return;
    }
    const timer = setTimeout(refetch, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [search, statusFilter, urgentOnly, refetch]);

  // The machine board advances a job's stage on Start / Complete. It has no way
  // to reach into this list, so it fires an event and we pull fresh rows.
  useEffect(() => {
    window.addEventListener(JOBS_CHANGED_EVENT, refetch);
    return () => window.removeEventListener(JOBS_CHANGED_EVENT, refetch);
  }, [refetch]);

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

  function onJobUpdated(updatedJob: Job) {
    setJobs((prev) =>
      prev
        .map((j) => (j.id === updatedJob.id ? updatedJob : j))
        .sort((a, b) => {
          if (!a.delivery_date) return 1;
          if (!b.delivery_date) return -1;
          return new Date(a.delivery_date).getTime() - new Date(b.delivery_date).getTime();
        })
    );
  }

  function onJobDeleted(jobId: string) {
    setJobs((prev) => prev.filter((j) => j.id !== jobId));
  }

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
            refetch();
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
          {loading && jobs.length === 0 ? (
            <div className="space-y-3" aria-hidden="true">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-xl bg-white border border-black/[0.08] p-4 space-y-3">
                  <div className="h-3 w-24 rounded bg-black/[0.06]" />
                  <div className="h-4 w-2/3 rounded bg-black/[0.06]" />
                  <div className="h-12 w-full rounded-xl bg-black/[0.06]" />
                </div>
              ))}
            </div>
          ) : jobs.length === 0 ? (
            <EmptyState hasFilters={hasFilters} onClearFilters={clearFilters} />
          ) : (
            <ul className="space-y-3">
              {jobs.map((job) => (
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
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/12">
                {['Job Card / PO', 'Party / Job', 'Dispatch', 'Delivery', 'Type', 'Status', 'Last Updated', 'Actions'].map((col) => (
                  <th key={col} scope="col" className="px-4 py-3 text-left text-xs font-medium text-[var(--glass-muted)] uppercase tracking-wide whitespace-nowrap">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && jobs.length === 0 ? (
                <SkeletonRows rows={5} cols={8} />
              ) : jobs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-0">
                    <EmptyState hasFilters={hasFilters} onClearFilters={clearFilters} />
                  </td>
                </tr>
              ) : (
                jobs.map((job) => (
                  <JobRow
                    key={job.id}
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
