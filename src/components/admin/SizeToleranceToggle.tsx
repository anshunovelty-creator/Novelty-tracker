'use client';
// src/components/admin/SizeToleranceToggle.tsx
// "±2 mm" beside the die search. A die cut a millimetre or two off the job's
// size still runs, so the useful question at the rack is often "anything
// near 210?" rather than "exactly 210". Only means something for a number
// searched on length, width or all fields, so it's disabled otherwise.

import { cn } from '@/lib/utils';

export const SIZE_TOLERANCE_MM = 2;

export function canUseTolerance(search: string, field: string): boolean {
  return /^\d+(\.\d*)?$/.test(search.trim()) && ['all', 'length', 'width'].includes(field);
}

export default function SizeToleranceToggle({
  on, onChange, enabled,
}: { on: boolean; onChange: (on: boolean) => void; enabled: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on && enabled}
      disabled={!enabled}
      onClick={() => onChange(!on)}
      title={enabled ? `Also match sizes within ${SIZE_TOLERANCE_MM} mm` : 'Type a size to search near it'}
      className={cn(
        'min-h-11 shrink-0 whitespace-nowrap rounded-[10px] border px-3 font-mono text-sm font-medium transition-colors disabled:opacity-40',
        on && enabled
          ? 'border-brand-ink bg-brand-ink text-white'
          : 'border-brand-border bg-white text-brand-ink hover:bg-brand-surface-alt',
      )}
    >
      ±{SIZE_TOLERANCE_MM} mm
    </button>
  );
}
