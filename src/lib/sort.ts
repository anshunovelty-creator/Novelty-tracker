// src/lib/sort.ts
// Shared comparator for click-to-sort table headers, extracted from the
// pattern JobSeparationManager introduced so every admin table sorts the
// same way. Nulls always sort to the end regardless of direction — "not
// set" reads as "furthest away" either way.

export type SortDir = 'asc' | 'desc';
export type SortKind = 'text' | 'number' | 'date' | 'month-code';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Month-coded serials — job card numbers ('aug26-12') and Job Separation
 * Sr. Nos ('AUG26-12') — restart their sequence every month, so sorting
 * the raw string is wrong twice over: across months it's alphabetical
 * ('AUG' < 'OCT' < 'SEP', and 'DEC26' < 'JAN26' < 'SEP26' ignores the
 * year entirely), and within a month '-10' < '-2'. Parse into a
 * calendar period (year * 12 + month, so DEC26 < JAN27) and a numeric
 * sequence instead. Case-insensitive; null when the value isn't in
 * MonYY-N form (e.g. a hand-pinned Sr. No.).
 */
export function parseMonthCode(value: string | null | undefined): { period: number; seq: number } | null {
  if (!value) return null;
  const match = value.trim().match(/^([a-z]{3})(\d{2})-(\d+)$/i);
  if (!match) return null;
  const monthIndex = MONTHS.indexOf(match[1].toLowerCase());
  if (monthIndex === -1) return null;
  return { period: Number(match[2]) * 12 + monthIndex, seq: Number(match[3]) };
}

// Calendar order for parseable codes; anything that doesn't parse sorts
// after them (as text among itself), still ahead of nulls.
function compareMonthCodes(av: string, bv: string): number {
  const pa = parseMonthCode(av);
  const pb = parseMonthCode(bv);
  if (pa && pb) return pa.period !== pb.period ? pa.period - pb.period : pa.seq - pb.seq;
  if (pa) return -1;
  if (pb) return 1;
  return av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
}

export function compareValues(av: unknown, bv: unknown, kind: SortKind): number {
  if (av === null || av === undefined) return bv === null || bv === undefined ? 0 : 1;
  if (bv === null || bv === undefined) return -1;

  if (kind === 'number') return (av as number) - (bv as number);
  if (kind === 'date') return new Date(av as string).getTime() - new Date(bv as string).getTime();
  if (kind === 'month-code') return compareMonthCodes(String(av), String(bv));
  return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' });
}
