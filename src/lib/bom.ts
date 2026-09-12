// src/lib/bom.ts
// The one formula behind Bill of Material, shared by the API (which prices
// each row it returns) and the costing table (which previews a row's
// expense live while the inputs are still being typed). Two copies of a
// pricing formula is how a preview and a saved figure end up disagreeing.

/**
 * Material cost for a job: running metres × width (mm → m) × ₹ per m².
 *
 * Null — never 0 — when any input is missing or the material has no rate
 * yet. A ₹0 expense next to a real order value would read as a perfect
 * margin, which is the one wrong answer this screen must never give.
 * Rounded to paise.
 */
export function materialExpense(
  runningMeter:    number | null | undefined,
  materialWidthMm: number | null | undefined,
  ratePerSqm:      number | null | undefined,
): number | null {
  if (!runningMeter || runningMeter <= 0) return null;
  if (!materialWidthMm || materialWidthMm <= 0) return null;
  if (!ratePerSqm || ratePerSqm <= 0) return null;
  return Math.round(runningMeter * (materialWidthMm / 1000) * ratePerSqm * 100) / 100;
}

/** Order value minus material expense. Null until both sides are known. */
export function orderDifference(
  orderValue: number | null | undefined,
  expense:    number | null | undefined,
): number | null {
  if (orderValue === null || orderValue === undefined) return null;
  if (expense === null || expense === undefined) return null;
  return Math.round((orderValue - expense) * 100) / 100;
}

/** Rupees with Indian grouping, no currency sign — the caller places the ₹. */
export function formatInr(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/**
 * The PostgREST embed for the Job Separation fields a request or costing is
 * read against. One string, so the inbox and the costing table describe a
 * job with the same fields.
 */
export const BOM_JOB_SUMMARY_SELECT =
  'job:job_separations(id, sr_no, party, po_no, po_date, pm_code, material_name, quantity, order_value, created_at)';
