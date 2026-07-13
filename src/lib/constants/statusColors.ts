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

export const STATUS_COLORS: Record<Stage, ColorConfig> = {
  'PO Received':             { bg: 'bg-slate-100',   text: 'text-slate-700',   border: 'border border-slate-200' },
  'Artwork Received':        { bg: 'bg-purple-100',  text: 'text-purple-700',  border: 'border border-purple-200' },
  'Prepress / Design Check': { bg: 'bg-sky-100',     text: 'text-sky-700',     border: 'border border-sky-200' },
  'Sample Printing':         { bg: 'bg-amber-100',   text: 'text-amber-800',   border: 'border border-amber-200' },
  'Shade Card Sent':         { bg: 'bg-orange-100',  text: 'text-orange-700',  border: 'border border-orange-200' },
  'Shade Card Approved':     { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border border-emerald-200' },
  'In Printing':             { bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border border-emerald-300' },
  'Slitting':                { bg: 'bg-sky-100',     text: 'text-sky-700',     border: 'border border-sky-200' },
  'Quality Check':           { bg: 'bg-cyan-100',    text: 'text-cyan-800',    border: 'border border-cyan-200' },
  'Packing':                 { bg: 'bg-purple-100',  text: 'text-purple-700',  border: 'border border-purple-200' },
  'Ready to Dispatch':       { bg: 'bg-yellow-100',  text: 'text-yellow-800',  border: 'border border-yellow-300' },
  'Partial Dispatch':        { bg: 'bg-amber-100',   text: 'text-amber-800',   border: 'border border-amber-300' },
  'Dispatched':              { bg: 'bg-emerald-600', text: 'text-white',       border: 'border border-emerald-600' },
  'On Hold':                 { bg: 'bg-amber-100',   text: 'text-amber-800',   border: 'border border-amber-300' },
  'PO Closed':               { bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border border-emerald-300' },
};

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
