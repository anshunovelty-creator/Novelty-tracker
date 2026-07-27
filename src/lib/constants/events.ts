// src/lib/constants/events.ts
// ============================================================
// Window event names used to nudge sibling client components that hold their
// own copy of server data. Declared once here — a typo in either the dispatcher
// or the listener would fail silently.
// ============================================================

/**
 * A job changed outside the jobs table — the machine board carrying a stage
 * forward on Start / Complete, or the Releases panel dispatching a release
 * (which moves the job's dispatched totals). JobsTable and JobDetailClient
 * listen and refetch.
 */
export const JOBS_CHANGED_EVENT = 'novelty:jobs-changed';

/**
 * A dashboard stat was clicked and wants the jobs table to narrow to the rows
 * behind that number. JobsTable listens, applies the filter, and scrolls
 * itself into view.
 *
 * Only stats that map onto a filter the table actually supports dispatch this.
 * "Dispatched This Month" and "On-Time Delivery" describe closed/historical
 * jobs that are not in the active table at all, so they stay non-interactive
 * rather than filtering to a guaranteed-empty result.
 */
export const JOBS_FILTER_EVENT = 'novelty:jobs-filter';

export type JobsFilterDetail = {
  /** A pipeline stage, or '' to clear the status filter. */
  status?: string;
  urgent?: boolean;
};
