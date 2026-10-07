'use client';
// src/components/admin/JobsTable.tsx

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useUrlSearch } from '@/hooks/useUrlSearch';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cn, sortJobs, type JobSortOption } from '@/lib/utils';
import { compareValues, type SortDir, type SortKind } from '@/lib/sort';
import { JOBS_CHANGED_EVENT, JOBS_FILTER_EVENT, type JobsFilterDetail } from '@/lib/constants/events';
import type { Job, AddJobFormData } from '@/lib/types';
import type { DeptPermissions } from '@/lib/constants/departments';
import JobRow, { JOB_ROW_COLS } from './JobRow';
import JobCard from './JobCard';
import FilterBar from './FilterBar';
import AddJobForm, { type AddJobFormHandle } from './AddJobForm';
import SortableHeaderLabel from './SortableHeaderLabel';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { SearchClearButton } from '@/components/ui/SearchClearButton';
import Link from 'next/link';
import { Search, SearchX, SlidersHorizontal } from 'lucide-react';
import {
  istToday, needsAttention, dueThisWeek, attentionCompare, type JobView,
} from '@/lib/jobViews';

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
};

// Header labels for the desk table — Job Separation's worksheet columns,
// with Stage and Delivery Date in place of its artwork, order value, job
// card and AW columns. Must stay in the same order — and at the same count
// (JOB_ROW_COLS) — as the <td>s in JobRow.
const JOB_COLUMNS = [
  'Sr No', 'Party', 'PO No / Date', 'PM Code / Material', 'Qty / Rate', 'Unit',
  'Stage', 'Delivery Date', 'Actions',
] as const;

// Click-to-sort, alongside (not replacing) the existing sortBy dropdown —
// whichever the user touched most recently wins; see colSortField below.
// Merged headers sort by the more useful of their two fields, same
// convention as JobSeparationManager.
type SortField = 'sr_no' | 'party' | 'po_date' | 'pm_code' | 'label_qty' | 'unit' | 'status' | 'delivery_date';

const COLUMN_SORT_FIELDS: Partial<Record<typeof JOB_COLUMNS[number], SortField>> = {
  'Sr No':              'sr_no',
  'Party':              'party',
  'PO No / Date':       'po_date',
  'PM Code / Material': 'pm_code',
  'Qty / Rate':         'label_qty',
  'Unit':               'unit',
  'Stage':              'status',
  'Delivery Date':      'delivery_date',
};

const SORT_FIELD_KIND: Record<SortField, SortKind> = {
  sr_no: 'month-code', party: 'text', po_date: 'date', pm_code: 'text',
  label_qty: 'number', unit: 'text', status: 'text', delivery_date: 'date',
};

// Sr No is the job card number and Unit the printing unit's name —
// everything else is the job's own column.
function sortValue(job: Job, field: SortField): unknown {
  if (field === 'sr_no') return job.job_card_number;
  if (field === 'unit')  return job.printing_units?.name ?? null;
  return job[field];
}

// The view tabs over the table. The first three slice the active list the
// table already holds; Closed is its own request, made only when opened.
const VIEWS: { id: JobView; label: string; caption: string }[] = [
  { id: 'attention', label: 'Needs attention', caption: 'Late, on hold or urgent — most pressing first' },
  { id: 'week',      label: 'Due this week',   caption: 'Delivery due in the next seven days' },
  { id: 'all',       label: 'All active',      caption: 'Every job still in production' },
  { id: 'closed',    label: 'Closed',          caption: 'Closed POs — read-only history' },
];

// Last tab used, per browser — same convention as the machine board's
// open/closed preference in DashboardBoard.
const VIEW_KEY = 'meterlabels.dashboard.view';

function readView(): JobView | null {
  try {
    const v = window.localStorage.getItem(VIEW_KEY);
    return VIEWS.some((x) => x.id === v) ? (v as JobView) : null;
  } catch { return null; }
}

type DuplicatePrefill = Pick<AddJobFormData,
  'party' | 'pm_code' | 'job_name' | 'label_qty' | 'job_type' | 'notes'
>;

// A stable reference for "no data yet" — `data ?? []` would otherwise hand
// back a fresh array every render, defeating the sortedJobs useMemo below.
const EMPTY_JOBS: Job[] = [];

export default function JobsTable({ initialJobs, dept, addJobFormRef, hideAddTrigger }: Props) {
  const [search,       setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [urgentOnly,   setUrgentOnly]   = useState(false);
  const [sortBy,       setSortBy]       = useState<JobSortOption>('delivery_asc');
  // null until a header is clicked — the dropdown drives the order until
  // then. Set together, so whichever control the user touched last wins:
  // picking a dropdown option clears this (see the FilterBar handler below).
  const [colSortField, setColSortField] = useState<SortField | null>(null);
  const [colSortDir,   setColSortDir]   = useState<SortDir>('asc');
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

  // Which tab is open. null until the stored choice is read after mount;
  // until then (and when nothing is stored) Needs attention leads whenever
  // it has anything in it, else All active.
  const [storedView, setStoredView] = useState<JobView | null>(null);
  useEffect(() => { setStoredView(readView()); }, []);
  function chooseView(v: JobView) {
    setStoredView(v);
    try { window.localStorage.setItem(VIEW_KEY, v); } catch { /* this visit only */ }
  }
  // Opened from the Ctrl K palette (/admin?q=…): search every active job,
  // not just the remembered tab — without overwriting that remembered tab.
  useUrlSearch(setSearch, () => setStoredView('all'));

  const fetchJobs = (closed: boolean) => async () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (statusFilter)    params.set('status', statusFilter);
      if (urgentOnly)      params.set('urgent', 'true');
      if (closed)          params.set('closed', 'true');
      const res  = await fetch(`/api/jobs?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load jobs');
      return data.jobs as Job[];
  };

  const jobsQuery = useQuery({
    queryKey: ['jobs', debouncedSearch, statusFilter, urgentOnly, false],
    queryFn: fetchJobs(false),
    // Seeds the unfiltered view from the server component's own query, so
    // the very first mount never re-fetches what the server already sent.
    // React Query only uses this when the cache has nothing yet for this
    // exact key — a second visit within the session uses its own cache
    // (kept fresh by onJobUpdated/onJobDeleted below) instead of this prop.
    initialData: !debouncedSearch && !statusFilter && !urgentOnly ? initialJobs : undefined,
  });
  const activeJobs = jobsQuery.data ?? EMPTY_JOBS;

  // Tab counts come from the active list; "today" is the plant's (IST).
  const today = istToday();
  const counts = useMemo(() => ({
    attention: activeJobs.filter((j) => needsAttention(j, today)).length,
    week:      activeJobs.filter((j) => dueThisWeek(j, today)).length,
    all:       activeJobs.length,
  }), [activeJobs, today]);

  const view: JobView = storedView ?? (counts.attention > 0 ? 'attention' : 'all');

  const closedQuery = useQuery({
    queryKey: ['jobs', debouncedSearch, statusFilter, urgentOnly, true],
    queryFn:  fetchJobs(true),
    enabled:  view === 'closed',
  });

  const jobs    = view === 'closed' ? (closedQuery.data ?? EMPTY_JOBS) : activeJobs;
  const loading = view === 'closed' ? closedQuery.isFetching : jobsQuery.isFetching;

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
  const tableRef = useRef<HTMLElement>(null);
  useEffect(() => {
    function onFilter(e: Event) {
      const detail = (e as CustomEvent<JobsFilterDetail>).detail;
      if (!detail) return;
      if (detail.status !== undefined) setStatusFilter(detail.status);
      if (detail.urgent !== undefined) setUrgentOnly(detail.urgent);
      setStoredView('all');
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
  // All row callbacks are stable (useCallback) so the memoised JobRow /
  // JobCard only re-render when their own job or expanded state changes.
  const onJobUpdated = useCallback((updatedJob: Job) => {
    queryClient.setQueriesData<Job[]>(
      { queryKey: ['jobs'] },
      // Merged, not swapped: an edit's response may leave out the joins
      // (Sr No, printing unit) the list was fetched with.
      (old) => old?.map((j) => (j.id === updatedJob.id ? { ...j, ...updatedJob } : j))
    );
  }, [queryClient]);

  const onJobDeleted = useCallback((jobId: string) => {
    queryClient.setQueriesData<Job[]>(
      { queryKey: ['jobs'] },
      (old) => old?.filter((j) => j.id !== jobId)
    );
  }, [queryClient]);

  const toggleExpand = useCallback((jobId: string) => {
    setExpandedId((prev) => (prev === jobId ? null : jobId));
  }, []);

  const sortedJobs = useMemo(() => {
    const inView =
      view === 'attention' ? jobs.filter((j) => needsAttention(j, today)) :
      view === 'week'      ? jobs.filter((j) => dueThisWeek(j, today)) :
      jobs;
    // Needs attention has an order of its own — most pressing first — until
    // someone clicks a header to sort it differently.
    if (!colSortField && view === 'attention') return [...inView].sort(attentionCompare(today));
    if (!colSortField) return sortJobs(inView, sortBy);
    const kind = SORT_FIELD_KIND[colSortField];
    const sorted = [...inView];
    sorted.sort((a, b) => {
      const diff = compareValues(sortValue(a, colSortField), sortValue(b, colSortField), kind);
      return colSortDir === 'asc' ? diff : -diff;
    });
    return sorted;
  }, [jobs, view, today, sortBy, colSortField, colSortDir]);

  // Click a header to sort by it; click the same one again to flip
  // direction. Overrides the dropdown until the dropdown is used again.
  function handleColSort(field: SortField) {
    if (field === colSortField) {
      setColSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setColSortField(field);
      setColSortDir('asc');
    }
  }

  const hasFilters = Boolean(search || statusFilter || urgentOnly);

  // Stage, sort and urgent sit behind a Filters button. Opened by hand, and
  // forced open while any of them is narrowing or reordering the list, so an
  // active filter is never hidden.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilterCount = (statusFilter ? 1 : 0) + (urgentOnly ? 1 : 0) + (sortBy !== 'delivery_asc' ? 1 : 0);
  const showFilters = filtersOpen || activeFilterCount > 0;

  function clearFilters() {
    setSearch('');
    setStatusFilter('');
    setUrgentOnly(false);
  }

  // Called by JobDuplicateButton — sets prefill and triggers new form key to open fresh
  const handleDuplicate = useCallback((data: DuplicatePrefill) => {
    setPrefill(data);
    setFormKey((k) => k + 1); // forces AddJobForm to remount with new prefill
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const viewMeta = VIEWS.find((v) => v.id === view)!;

  // Arrow keys move between tabs (WAI-ARIA tabs pattern, automatic activation).
  function onTabKey(e: React.KeyboardEvent, i: number) {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = VIEWS[(i + step + VIEWS.length) % VIEWS.length];
    chooseView(next.id);
    document.getElementById(`jobs-tab-${next.id}`)?.focus();
  }

  return (
    <div>
      {/* Add Job form — opened from the page header's "Add job" button, and
          by Duplicate on a row. Contributes nothing while closed. */}
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

      <section
        ref={tableRef}
        aria-label="Jobs"
        className="rounded-2xl border border-brand-border bg-white shadow-[0_1px_2px_rgba(12,42,32,0.04)]"
      >
        {/* Views + search, one row: the tabs say which slice, the count on
            each says how big before you open it. */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 border-b border-brand-line-soft px-4 sm:px-6">
          <div role="tablist" aria-label="Job views" className="-mb-px flex gap-6 overflow-x-auto sm:gap-7">
            {VIEWS.map((v, i) => {
              const on    = v.id === view;
              const count = v.id === 'closed' ? null : counts[v.id];
              return (
                <button
                  key={v.id}
                  id={`jobs-tab-${v.id}`}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  aria-controls="jobs-panel"
                  tabIndex={on ? 0 : -1}
                  onClick={() => chooseView(v.id)}
                  onKeyDown={(e) => onTabKey(e, i)}
                  className={cn(
                    'flex h-12 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-0.5 text-sm transition-colors',
                    on
                      ? 'border-brand-ink font-semibold text-brand-ink'
                      : 'border-transparent font-medium text-brand-muted hover:text-brand-ink',
                  )}
                >
                  {v.label}
                  {count !== null && (
                    <span className={cn(
                      'rounded-full px-[7px] py-px font-mono text-xs font-medium',
                      v.id === 'attention' && count > 0
                        ? 'bg-[#FEF2F2] text-[#B91C1C]'
                        : 'bg-[#F1F5F2] text-brand-muted',
                    )}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="my-2 flex min-w-0 flex-[0_1_420px] items-center gap-2">
          <label className="relative flex h-10 min-w-0 flex-1 items-center gap-2 rounded-[10px] bg-brand-bg px-3 text-brand-muted focus-within:shadow-[0_0_0_4px_rgba(16,85,63,0.16)]">
            <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="sr-only">Search jobs</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search job card, PM, party, PO"
              data-global-search
              className="min-w-0 flex-1 bg-transparent pr-14 text-sm text-brand-ink outline-none placeholder:text-brand-muted [&::-webkit-search-cancel-button]:appearance-none"
            />
            {search ? (
              <SearchClearButton value={search} onClear={() => setSearch('')} />
            ) : (
              <kbd className="pointer-events-none absolute right-2.5 hidden rounded-md border border-brand-border bg-white px-1.5 py-0.5 font-mono text-[10px] text-brand-muted sm:block">
                /
              </kbd>
            )}
          </label>
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={showFilters}
            aria-controls="jobs-filters"
            className={cn(
              'inline-flex h-10 min-h-10 shrink-0 items-center gap-1.5 rounded-[10px] border px-3 text-[13px] font-medium transition-colors',
              showFilters
                ? 'border-brand-primary text-brand-primary'
                : 'border-brand-border text-brand-ink hover:bg-brand-bg',
            )}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            Filters
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-brand-primary px-1.5 font-mono text-[11px] text-white">{activeFilterCount}</span>
            )}
          </button>
          </div>
        </div>

        {/* Stage filter, sort and urgent — behind the Filters button. */}
        {showFilters && (
        <div id="jobs-filters" className="border-b border-brand-line-soft bg-brand-surface-alt px-4 py-3 sm:px-6">
          <FilterBar
            hideSearch
            search={search}
            onSearchChange={setSearch}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            urgentOnly={urgentOnly}
            onUrgentOnlyChange={setUrgentOnly}
            sortBy={sortBy}
            onSortByChange={(v) => { setSortBy(v); setColSortField(null); }}
            onClearFilters={clearFilters}
          />
        </div>
        )}

        <div id="jobs-panel" role="tabpanel" aria-labelledby={`jobs-tab-${view}`}>
          {loading && (
            <div className="relative h-0.5 overflow-hidden bg-brand-primary/15" role="status" aria-label="Loading jobs">
              <div className="loading-bar absolute inset-y-0 left-0 w-2/5 bg-brand-primary" />
            </div>
          )}

          {/* Phone + tablet: card list. Below lg the 9-column table would
              scroll sideways to reach Stage, so cards cover phones and
              tablets both; see JobCard. */}
          <div className="bg-brand-surface-alt p-3 lg:hidden">
            {loading && sortedJobs.length === 0 ? (
              <div className="space-y-3" aria-hidden="true">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="space-y-3 rounded-xl border border-black/[0.08] bg-white p-4">
                    <div className="h-3 w-24 rounded bg-black/[0.06]" />
                    <div className="h-4 w-2/3 rounded bg-black/[0.06]" />
                    <div className="h-12 w-full rounded-xl bg-black/[0.06]" />
                  </div>
                ))}
              </div>
            ) : sortedJobs.length === 0 ? (
              <EmptyState view={view} search={debouncedSearch.trim()} hasFilters={hasFilters} onClearFilters={clearFilters} onShowAll={() => chooseView('all')} onSearchClosed={() => chooseView('closed')} />
            ) : (
              <ul className="space-y-3">
                {sortedJobs.map((job) => (
                  <li key={job.id}>
                    <JobCard
                      job={job}
                      dept={dept}
                      isExpanded={expandedId === job.id}
                      onToggleExpand={toggleExpand}
                      onJobUpdated={onJobUpdated}
                      onJobDeleted={onJobDeleted}
                      onDuplicate={handleDuplicate}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Desk: table. The scroll region is bounded (max-h) so the sticky
              header has a scrollport to stick to; min-w forces horizontal
              scroll only once every column is at its floor, and the Job cell
              stays pinned through it. */}
          <div className="hidden lg:block">
            <div className="table-scroll-wrapper max-h-[72vh] overflow-y-auto">
              <table className="w-full min-w-[1180px] border-collapse text-sm">
                <thead>
                  <tr>
                    {JOB_COLUMNS.map((col) => (
                      <th
                        key={col}
                        scope="col"
                        // Same header as Job Separation's worksheet: small caps
                        // on the mint fill, a rule between columns, Sr No
                        // pinned left through both scroll axes.
                        className={cn(
                          'sticky top-0 z-10 whitespace-nowrap px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--glass-muted)]',
                          'shadow-[inset_0_-1px_0_#E3EBE6]',
                          col === 'Sr No' && 'left-0 z-20',
                          col !== 'Actions' && 'border-r border-brand-line-soft',
                          col === 'Actions' && 'text-right',
                        )}
                      >
                        {col === 'Actions' ? (
                          <span className="sr-only">Actions</span>
                        ) : COLUMN_SORT_FIELDS[col] ? (
                          <SortableHeaderLabel
                            label={col}
                            active={colSortField === COLUMN_SORT_FIELDS[col]}
                            dir={colSortDir}
                            onClick={() => handleColSort(COLUMN_SORT_FIELDS[col]!)}
                          />
                        ) : col}
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
                        <EmptyState view={view} search={debouncedSearch.trim()} hasFilters={hasFilters} onClearFilters={clearFilters} onShowAll={() => chooseView('all')} onSearchClosed={() => chooseView('closed')} />
                      </td>
                    </tr>
                  ) : (
                    sortedJobs.map((job, i) => (
                      <JobRow
                        key={job.id}
                        job={job}
                        dept={dept}
                        index={i}
                        today={today}
                        isExpanded={expandedId === job.id}
                        onToggleExpand={toggleExpand}
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

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-brand-line-soft px-4 py-3 text-[13px] text-brand-muted sm:px-6">
          <span>{viewMeta.caption}</span>
          <span className="font-mono">
            {sortedJobs.length} {hasFilters ? 'matching' : sortedJobs.length === 1 ? 'job' : 'jobs'}
          </span>
        </div>
      </section>
    </div>
  );
}

// Empty is a state, not a missing table. Filtered-empty offers the way out;
// genuinely-empty points at the one thing to do next.
function EmptyState({
  view, search, hasFilters, onClearFilters, onShowAll, onSearchClosed,
}: {
  view:           JobView;
  search:         string;
  hasFilters:     boolean;
  onClearFilters: () => void;
  onShowAll:      () => void;
  onSearchClosed: () => void;
}) {
  // A search that found nothing usually means the job isn't active: it was
  // closed, or it is still a line in Job Separation. Offer both places.
  if (search) {
    return (
      <div className="flex flex-col items-center justify-center gap-3.5 px-4 py-12 text-center">
        <span aria-hidden="true" className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#F1F5F2] text-brand-primary">
          <SearchX className="h-[26px] w-[26px]" strokeWidth={1.8} />
        </span>
        <h2 className="text-lg font-semibold text-brand-ink">No jobs match “{search}”</h2>
        <p className="max-w-[40ch] text-sm leading-normal text-brand-muted">
          {view === 'closed'
            ? 'It isn’t a closed PO either. It may still be a line in Job Separation.'
            : 'It isn’t in active jobs. It may be closed, or still a line in Job Separation.'}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {view !== 'closed' && (
            <button
              type="button"
              onClick={onSearchClosed}
              className="inline-flex min-h-[44px] items-center rounded-[10px] border border-brand-border bg-white px-3.5 text-sm font-medium text-brand-ink transition-colors hover:bg-brand-surface-hover"
            >
              Search closed jobs
            </button>
          )}
          <Link
            href={`/admin/job-separation?q=${encodeURIComponent(search)}`}
            className="inline-flex min-h-[44px] items-center rounded-[10px] bg-brand-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-primary-hover"
          >
            Look in Job Separation
          </Link>
        </div>
      </div>
    );
  }

  const quietView = !hasFilters && (view === 'attention' || view === 'week');
  const title =
    hasFilters          ? 'No jobs match your filters.' :
    view === 'attention' ? 'Nothing needs attention.' :
    view === 'week'      ? 'Nothing due this week.' :
    view === 'closed'    ? 'No closed POs yet.' :
                           'No active jobs yet.';
  const body =
    hasFilters          ? 'Try a different search term, or clear the filters to see every job in this view.' :
    view === 'attention' ? 'No job is late, on hold or marked urgent.' :
    view === 'week'      ? 'No active job has a delivery date in the next seven days.' :
    view === 'closed'    ? 'A PO lands here once Admin closes it.' :
                           'Use “Add job” above to put the first PO into the pipeline.';
  return (
    <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
      <p className="text-sm font-medium text-brand-ink">{title}</p>
      <p className="mt-1 max-w-[40ch] text-[13px] text-brand-muted">{body}</p>
      {(hasFilters || quietView) && (
        <button
          onClick={hasFilters ? onClearFilters : onShowAll}
          className={cn(
            'mt-4 inline-flex min-h-[44px] items-center justify-center rounded-[10px] px-4',
            'border border-brand-border text-[13px] font-medium text-brand-ink',
            'transition-colors hover:bg-brand-bg',
          )}
        >
          {hasFilters ? 'Clear filters' : 'See all active jobs'}
        </button>
      )}
    </div>
  );
}
