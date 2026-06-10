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
  'PO Received':             { bg: 'bg-gray-100',    text: 'text-gray-700' },
  'Artwork Received':        { bg: 'bg-purple-100',  text: 'text-purple-700' },
  'Prepress / Design Check': { bg: 'bg-blue-100',    text: 'text-blue-700' },
  'Sample Printing':         { bg: 'bg-amber-100',   text: 'text-amber-700' },
  'Shade Card Sent':         { bg: 'bg-orange-100',  text: 'text-orange-700' },
  'Shade Card Approved':     { bg: 'bg-green-100',   text: 'text-green-700' },
  'In Printing':             { bg: 'bg-green-100',   text: 'text-green-700' },
  'Slitting':                { bg: 'bg-blue-100',    text: 'text-blue-700' },
  'Quality Check':           { bg: 'bg-sky-100',     text: 'text-sky-700' },
  'Packing':                 { bg: 'bg-purple-100',  text: 'text-purple-700' },
  'Ready to Dispatch':       { bg: 'bg-yellow-100',  text: 'text-yellow-800' },
  'Partial Dispatch':        { bg: 'bg-amber-100',   text: 'text-amber-700' },
  'Dispatched':              { bg: 'bg-green-100',   text: 'text-green-700' },
  'On Hold':                 { bg: 'bg-orange-100',  text: 'text-orange-700' },
  'PO Closed':               { bg: 'bg-green-100',   text: 'text-green-700' },
};

// Row background tints for admin panel
// These override based on urgency / special status (On Hold > urgent)
export const ROW_URGENCY_STYLES = {
  onHold:   'border-l-4 border-l-amber-400  bg-amber-50/60',
  urgent1:  'border-l-4 border-l-red-500    bg-red-50/50',
  urgent2:  'border-l-4 border-l-orange-400 bg-orange-50/50',
  urgent3:  'border-l-4 border-l-yellow-400 bg-yellow-50/40',
  qc:       'border-l-4 border-l-sky-400    bg-sky-50/40',
  normal:   '',
} as const;
