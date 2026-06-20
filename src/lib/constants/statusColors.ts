// src/lib/constants/statusColors.ts
// ============================================================
// Status badge colors — exact map from the design spec.
// bg and text are Tailwind utility classes.
// ============================================================

import type { Stage } from './stages';

type ColorConfig = {
  bg: string;
  text: string;
  border?: string;
};

export const STATUS_COLORS: Record<Stage, ColorConfig> = {
  'PO Received':             { bg: 'bg-white/10',     text: 'text-white/80' },
  'Artwork Received':        { bg: 'bg-purple-400/15', text: 'text-purple-200' },
  'Prepress / Design Check': { bg: 'bg-sky-400/15',    text: 'text-sky-200' },
  'Sample Printing':         { bg: 'bg-amber-400/15',  text: 'text-amber-200' },
  'Shade Card Sent':         { bg: 'bg-orange-400/15', text: 'text-orange-200' },
  'Shade Card Approved':     { bg: 'bg-emerald-400/15', text: 'text-emerald-200' },
  'In Printing':             { bg: 'bg-emerald-400/15', text: 'text-emerald-200' },
  'Slitting':                { bg: 'bg-sky-400/15',    text: 'text-sky-200' },
  'Quality Check':           { bg: 'bg-sky-400/18',    text: 'text-sky-200' },
  'Packing':                 { bg: 'bg-purple-400/15', text: 'text-purple-200' },
  'Ready to Dispatch':       { bg: 'bg-yellow-400/15', text: 'text-yellow-100' },
  'Partial Dispatch':        { bg: 'bg-amber-400/15',  text: 'text-amber-200' },
  'Dispatched':              { bg: 'bg-emerald-400/18', text: 'text-emerald-200' },
  'On Hold':                 { bg: 'bg-amber-400/18',  text: 'text-amber-100' },
  'PO Closed':               { bg: 'bg-emerald-400/18', text: 'text-emerald-200' },
};

// Row background tints for admin panel
// These override based on urgency / special status (On Hold > urgent)
export const ROW_URGENCY_STYLES = {
  onHold:   'border-l-4 border-l-amber-400/80  bg-amber-400/[0.07]',
  urgent1:  'border-l-4 border-l-red-400/90    bg-red-400/[0.08]',
  urgent2:  'border-l-4 border-l-orange-400/80 bg-orange-400/[0.07]',
  urgent3:  'border-l-4 border-l-yellow-400/70 bg-yellow-400/[0.05]',
  qc:       'border-l-4 border-l-sky-400/80    bg-sky-400/[0.06]',
  normal:   '',
} as const;

// Job-type badge (dark glass)
export const JOB_TYPE_BADGE: Record<'New' | 'Repeat' | 'Artwork Changed', string> = {
  'New':             'bg-sky-400/15 text-sky-200',
  'Repeat':          'bg-white/10 text-white/70',
  'Artwork Changed': 'bg-purple-400/15 text-purple-200',
};

// Urgent priority badge (dark glass) — keyed by urgent_priority (1,2,else)
export function urgentBadgeClass(priority: number | null): string {
  if (priority === 1) return 'bg-red-400/15 text-red-200';
  if (priority === 2) return 'bg-orange-400/15 text-orange-200';
  return 'bg-yellow-400/15 text-yellow-100';
}
