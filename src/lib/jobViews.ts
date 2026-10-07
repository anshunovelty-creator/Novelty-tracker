// src/lib/jobViews.ts
// The dashboard's view tabs — Needs attention, Due this week, All active —
// and the delivery wording on each row. Pure functions over the job list the
// table already holds, so the tabs cost no extra requests.
//
// Dates are compared as plain 'YYYY-MM-DD' strings in IST: delivery_date is
// a date column, and "today" must be the plant's today, not the browser's.
// (lib/api/machineAnalytics has an istToday too, but that module pulls in the
// server-only admin client, so client components can't import it.)

import type { Job } from '@/lib/types';

export type JobView = 'attention' | 'week' | 'all' | 'closed';

/** Stages after which a delivery date no longer means anything. */
const DELIVERED = new Set(['Dispatched', 'PO Closed']);

/** Today in IST as 'YYYY-MM-DD'. */
export function istToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
}

/** Whole days from `from` to `to` (both 'YYYY-MM-DD'); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const ms = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10))
           - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  return Math.round(ms / 86_400_000);
}

/** Days until delivery, or null when there is no date or it's already out. */
export function daysToDelivery(job: Pick<Job, 'delivery_date' | 'status'>, today: string): number | null {
  if (!job.delivery_date || DELIVERED.has(job.status)) return null;
  return daysBetween(today, job.delivery_date.slice(0, 10));
}

/** Late, on hold, or urgent. */
export function needsAttention(job: Job, today: string): boolean {
  const d = daysToDelivery(job, today);
  return (d !== null && d < 0) || job.status === 'On Hold' || job.urgent;
}

/** Delivery falls in the next seven days, today included. */
export function dueThisWeek(job: Job, today: string): boolean {
  const d = daysToDelivery(job, today);
  return d !== null && d >= 0 && d <= 6;
}

/**
 * Most pressing first: late jobs by how late, then urgent by priority
 * (P1 first), then on hold, then the rest by delivery date.
 */
export function attentionCompare(today: string) {
  const rank = (j: Job): [number, number] => {
    const d = daysToDelivery(j, today);
    if (d !== null && d < 0)    return [0, d];                    // more days late sorts first
    if (j.urgent)               return [1, j.urgent_priority ?? 9];
    if (j.status === 'On Hold') return [2, 0];
    return [3, d ?? Number.MAX_SAFE_INTEGER];
  };
  return (a: Job, b: Job) => {
    const [ra, va] = rank(a);
    const [rb, vb] = rank(b);
    return ra - rb || va - vb;
  };
}

export type DeliveryTone = 'late' | 'soon' | 'ok' | 'none';

/** "3 days late", "today", "tomorrow", "in 2 days" — the line under a delivery date. */
export function deliveryWords(
  job: Pick<Job, 'delivery_date' | 'status'>,
  today: string,
): { text: string; tone: DeliveryTone } {
  const d = daysToDelivery(job, today);
  if (d === null) return { text: '', tone: 'none' };
  if (d < 0)   return { text: `${-d} day${d === -1 ? '' : 's'} late`, tone: 'late' };
  if (d === 0) return { text: 'today', tone: 'soon' };
  if (d === 1) return { text: 'tomorrow', tone: 'soon' };
  if (d === 2) return { text: 'in 2 days', tone: 'soon' };
  return { text: `in ${d} days`, tone: 'ok' };
}

/** The Job Separation line a job was made from, when fetched with that join; null for a job added directly. */
export function separationOf(job: Pick<Job, 'job_separations'>) {
  return job.job_separations?.[0] ?? null;
}
