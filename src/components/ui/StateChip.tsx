// src/components/ui/StateChip.tsx
// A state, Control Room style: an 8px dot in the state's colour beside the
// state's name in ink — never a filled pastel pill (DESIGN.md). The same
// grammar as StatusBadge for job stages, for every other kind of state
// (shade card approval, making status, stock kind…).

import { cn } from '@/lib/utils';

type Props = {
  label:      string;
  /** The dot colour, a hex from the state's colour map. */
  dot:        string | undefined;
  className?: string;
};

export function StateChip({ label, dot, className }: Props) {
  return (
    <span className={cn('inline-flex items-center gap-2 whitespace-nowrap text-[13px] font-semibold text-brand-ink', className)}>
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 rounded-full shadow-[0_0_0_3px_#EEF2EF]"
        style={{ background: dot ?? '#94A39B' }}
      />
      {label}
    </span>
  );
}
