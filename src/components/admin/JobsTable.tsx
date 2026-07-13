'use client';
// src/components/admin/JobsTable.tsx

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import type { Job, AddJobFormData } from '@/lib/types';
import type { Department } from '@/lib/constants/departments';
import JobRow from './JobRow';
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

      {/* Table */}
      <div className="table-scroll-wrapper rounded-xl glass mt-3 overflow-hidden">
        {loading && (
          <div className="h-1 bg-brand-primary/20 relative overflow-hidden" role="status" aria-label="Loading jobs">
            <div className="loading-bar absolute inset-y-0 left-0 w-2/5 bg-brand-primary" />
          </div>
        )}

        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-white/12">
              {['PO / PM', 'Party / Job', 'Dispatch', 'Delivery', 'Type', 'Status', 'Last Updated', 'Actions'].map((col) => (
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
                <td colSpan={8} className="px-4 py-12 text-center text-[var(--glass-muted)] text-sm">
                  {search || statusFilter || urgentOnly
                    ? 'No jobs match your filters.'
                    : 'No active jobs. Add one above.'}
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
  );
}
