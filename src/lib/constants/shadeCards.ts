// src/lib/constants/shadeCards.ts
// ============================================================
// Shade card statuses and their badge colours.
//
// Migrated from the standalone Shade Card Tracker, which hardcoded its own
// hex palette (#FEF3C7 / #DCFCE7 …) because it was a separate product. Here
// the chips ride the same solid-pastel grammar as STATUS_COLORS in
// statusColors.ts — color-100 bg, color-700/800 text, color-200 border — so a
// shade card status reads exactly like a job stage does on the same screen.
// ============================================================

export type ShadeCardStatus =
  | 'Pending Approval'
  | 'Approved'
  | 'Rejected'
  | 'Revision Requested'
  | 'Expired';

/** Whether the physical shade card has been produced yet. */
export type MakingStatus = 'Pending' | 'Already Made';

/**
 * The statuses a user may actually pick. Rejected / Revision Requested /
 * Expired were retired at QC's request and are no longer offered — but they
 * stay in the type and in the colour maps below, because historical rows and
 * status-history entries still carry them and must render correctly.
 */
export const SHADE_CARD_STATUSES: ShadeCardStatus[] = [
  'Pending Approval',
  'Approved',
  'Rejected',
];

/** The two making states, in pick order. */
export const MAKING_STATUSES: MakingStatus[] = ['Pending', 'Already Made'];

type ColorConfig = {
  bg: string;
  text: string;
  border?: string;
};

// Amber for waiting, emerald for signed off — the same colour-to-state mapping
// the job stages use, so the two never contradict each other on one screen.
export const SHADE_CARD_STATUS_COLORS: Record<ShadeCardStatus, ColorConfig> = {
  'Pending Approval':   { bg: 'bg-amber-100',   text: 'text-amber-800',   border: 'border border-amber-200' },
  'Approved':           { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border border-emerald-200' },
  'Rejected':           { bg: 'bg-red-100',     text: 'text-red-700',     border: 'border border-red-200' },
  'Revision Requested': { bg: 'bg-purple-100',  text: 'text-purple-700',  border: 'border border-purple-200' },
  'Expired':            { bg: 'bg-slate-100',   text: 'text-slate-600',   border: 'border border-slate-200' },
};

export const MAKING_STATUS_COLORS: Record<MakingStatus, ColorConfig> = {
  'Pending':      { bg: 'bg-amber-100',   text: 'text-amber-800',   border: 'border border-amber-200' },
  'Already Made': { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border border-emerald-200' },
};

/** Rows per page in the shade card list. */
export const SHADE_CARD_PAGE_SIZE = 25;

/**
 * The field-scoped search options, shared by the API route and the manager so
 * the dropdown and the query can never drift apart. (The plates and dies
 * screens keep two copies in sync by hand; one exported list is the same
 * pattern without the drift.)
 *
 * `value` is what goes over the wire as ?field=. 'all' is the default and
 * skips the param, falling back to the multi-column OR search. Every column
 * here is TEXT, so they all take ilike — no integer special-casing, unlike
 * the plates search.
 */
export type ShadeCardSearchField = {
  value:       string;
  label:       string;
  placeholder: string;
  /** The column to match. Absent on 'all', which spans SHADE_CARD_SEARCH_COLUMNS. */
  column?:     string;
};

export const SHADE_CARD_SEARCH_FIELDS: ShadeCardSearchField[] = [
  { value: 'all',               label: 'All fields',    placeholder: 'Search party, PM code, product, shade card # or docket #' },
  { value: 'party',             label: 'Party',         placeholder: 'Search by party',         column: 'party' },
  { value: 'product_name',      label: 'Product',       placeholder: 'Search by product name',  column: 'product_name' },
  { value: 'pm_code',           label: 'PM code',       placeholder: 'Search by PM code',       column: 'pm_code' },
  { value: 'shade_card_number', label: 'Shade card #',  placeholder: 'Search by shade card #',  column: 'shade_card_number' },
  { value: 'docket_number',     label: 'Docket #',      placeholder: 'Search by docket #',      column: 'docket_number' },
  { value: 'notes',             label: 'Notes',         placeholder: 'Search within notes',     column: 'notes' },
  { value: 'updated_by_name',   label: 'Updated by',    placeholder: 'Search by who last changed it', column: 'updated_by_name' },
];

/** The columns an "All fields" search spans. Deliberately narrower than the
 *  list above: notes are long free text and would swamp a general search with
 *  incidental word matches, and nobody scanning the register searches for a
 *  card by who touched it last. Both stay available as explicit choices. */
export const SHADE_CARD_SEARCH_COLUMNS = [
  'party', 'pm_code', 'product_name', 'shade_card_number', 'docket_number',
] as const;

/** Resolve ?field= to a column, or null for the multi-column search.
 *  Returns null for anything unrecognised, so an unknown field widens the
 *  search rather than erroring or silently matching nothing. */
export function searchColumnFor(field: string | null | undefined): string | null {
  if (!field || field === 'all') return null;
  return SHADE_CARD_SEARCH_FIELDS.find((f) => f.value === field)?.column ?? null;
}

/** Is this a status a user is still allowed to choose? */
export function isSelectableStatus(value: unknown): value is ShadeCardStatus {
  return SHADE_CARD_STATUSES.includes(value as ShadeCardStatus);
}

export function isMakingStatus(value: unknown): value is MakingStatus {
  return MAKING_STATUSES.includes(value as MakingStatus);
}
