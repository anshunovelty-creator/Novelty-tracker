// src/lib/constants/statusColors.ts
// ============================================================
// Status badge colors — admin "Airy Green" light theme.
// Solid pastel chips (color-100 bg + color-700/800 text + color-200
// border) read clearly on white cards and keep color === state.
// bg / text / border are Tailwind utility classes.
// ============================================================

import type { Stage } from './stages';

type ColorConfig = {
  bg: string;
  text: string;
  border?: string;
};

// Control Room design system (DESIGN.md §2): a state is shown as an 8px dot
// beside the stage name — never as a filled pastel pill. STAGE_DOT is the dot
// colour per stage; the select/badge itself stays white with ink text.
export const STAGE_DOT: Record<Stage, string> = {
  'PO Received':         '#64748B',
  'Artwork Pending':     '#9333EA',
  'Plate Status':        '#4F46E5',
  'Job Card Done':       '#0284C7',
  'Sample Printing':     '#D97706',
  'Shade Card Sent':     '#EA580C',
  'Shade Card Approved': '#059669',
  'In Printing':         '#059669',
  'Slitting':            '#0284C7',
  'Quality Check':       '#0891B2',
  'Packing':             '#9333EA',
  'Ready to Dispatch':   '#CA8A04',
  'Partial Dispatch':    '#D97706',
  'Dispatched':          '#047857',
  'On Hold':             '#D97706',
  'PO Closed':           '#047857',
};

// Surface of a stage control (select / badge). Neutral for every stage: the
// colour lives only in STAGE_DOT. Kept as a per-stage record so existing
// call sites (JobRow, JobCard) keep working unchanged.
const NEUTRAL: ColorConfig = { bg: 'bg-white', text: 'text-[#0C2A20]', border: 'border border-[#E4EAE6]' };
export const STATUS_COLORS: Record<Stage, ColorConfig> = Object.fromEntries(
  (Object.keys(STAGE_DOT) as Stage[]).map((s) => [s, NEUTRAL]),
) as Record<Stage, ColorConfig>;

// Row background tints for admin panel.
// Urgency / special status reads through the row's background tint plus its
// status chip and P-badge — no left-stripe borders (DESIGN.md: stripes retired).
// These override based on urgency / special status (On Hold > urgent).
export const ROW_URGENCY_STYLES = {
  onHold:   'bg-amber-50',
  urgent1:  'bg-red-50',
  urgent2:  'bg-orange-50',
  urgent3:  'bg-yellow-50',
  qc:       'bg-sky-50',
  normal:   '',
} as const;

// Job-type badge (light theme)
export const JOB_TYPE_BADGE: Record<'New' | 'Repeat' | 'Artwork Changed', string> = {
  'New':             'bg-sky-100 text-sky-700 border border-sky-200',
  'Repeat':          'bg-slate-100 text-slate-600 border border-slate-200',
  'Artwork Changed': 'bg-purple-100 text-purple-700 border border-purple-200',
};

// Urgent priority badge (light theme) — keyed by urgent_priority (1,2,else)
export function urgentBadgeClass(priority: number | null): string {
  if (priority === 1) return 'bg-red-100 text-red-700 border border-red-200';
  if (priority === 2) return 'bg-orange-100 text-orange-700 border border-orange-200';
  return 'bg-yellow-100 text-yellow-800 border border-yellow-200';
}

// Printing unit chip: just the unit's number in a colored circle rather than
// the full "Unit-1" / "Unit-2" text — pink for Unit 1, green for Unit 2 (the
// floor's two presses today). Colors are dark enough to hold AA contrast
// against white digits. Falls back to grey + the name's first letter for any
// unit that isn't one of those two, since printing_units.name is admin-set
// free text, not a fixed enum. Shared by JobRow (desk table) and JobCard
// (phone list) so both breakpoints read the same badge.
export function unitDigit(name: string): string {
  return name.match(/\d+/)?.[0] ?? name.charAt(0).toUpperCase();
}
export function unitCircleClass(name: string): string {
  switch (name.match(/\d+/)?.[0]) {
    case '1':  return 'bg-pink-600';
    case '2':  return 'bg-emerald-700';
    default:   return 'bg-slate-400';
  }
}
