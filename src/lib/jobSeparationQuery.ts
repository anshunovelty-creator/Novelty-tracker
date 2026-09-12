// src/lib/jobSeparationQuery.ts
// How a Job Separation list request is scoped — the date range and the row
// cap. Lifted out of /api/job-separations so Bill of Material, which is the
// same rows seen through a costing lens, scopes them identically: the row
// the floor sees under "Current month" on one page is the row they see on
// the other.

// Default scope keeps both the payload and the query small — at 400-700
// rows added a month, "all time" grows unbounded while "this month" stays
// flat. Buckets on the same date the Sr. No. trigger uses — po_date when
// present, created_at otherwise (see trigger_set_job_separation_sr_no() in
// 051_job_separation_sr_no_by_po_date.sql) — so "Current month" always
// means "this month's Sr. No. series", not "entered this month". A PO
// dated 31 Aug added a few days into September must still show up under
// August, matching its AUG26 number.
export type DateRange = 'month' | '3months' | 'all';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istMonthStartUTC(monthsAgo: number): Date {
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  return new Date(
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - monthsAgo, 1) - IST_OFFSET_MS
  );
}

// po_date is a plain DATE — no time-of-day/timezone to resolve — so the
// boundary is a calendar date string, not an IST-adjusted instant.
function istMonthStartDateStr(monthsAgo: number): string {
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - monthsAgo, 1))
    .toISOString()
    .slice(0, 10);
}

export function parseDateRange(raw: string | null): DateRange {
  return raw === '3months' || raw === 'all' ? raw : 'month';
}

export function rangeBounds(range: DateRange): { poDateStart: string; createdAtStart: string } | null {
  if (range === 'all') return null;
  const monthsAgo = range === '3months' ? 2 : 0;
  return {
    poDateStart: istMonthStartDateStr(monthsAgo),
    createdAtStart: istMonthStartUTC(monthsAgo).toISOString(),
  };
}

/**
 * The PostgREST `or()` clause that puts a row in its Sr. No. bucket: po_date's
 * month when po_date is set, created_at's month for the legacy rows it
 * isn't (mirrors the trigger's own COALESCE). Null for "all" — no filter.
 */
export function rangeOrClause(range: DateRange): string | null {
  const bounds = rangeBounds(range);
  if (!bounds) return null;
  return `po_date.gte.${bounds.poDateStart},and(po_date.is.null,created_at.gte.${bounds.createdAtStart})`;
}

// Caps the payload the same way `range` caps the query — "Current month"
// stays under this on its own, but "All data" would otherwise return every
// row in the table (and grow every year). One extra row is requested past
// the limit purely to tell the client whether "Load more" should show.
export const DEFAULT_LIMIT = 500;
export const MAX_LIMIT = 2000;

export function parseLimit(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.trunc(n), MAX_LIMIT);
}

/**
 * The "All fields" search: whatever the shop can read off a PO — the sr.
 * no, the party, the PO no, the PM code, or the material (product) name.
 * Characters with meaning inside an or() clause are stripped rather than
 * escaped: this is a search box, not an expression language.
 */
export function searchOrClause(search: string): string {
  const escaped = search.replace(/[%,()]/g, ' ');
  return (
    `sr_no.ilike.%${escaped}%,party.ilike.%${escaped}%,po_no.ilike.%${escaped}%,` +
    `pm_code.ilike.%${escaped}%,material_name.ilike.%${escaped}%`
  );
}
