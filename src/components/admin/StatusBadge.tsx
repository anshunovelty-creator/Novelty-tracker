'use client';
// src/components/admin/StatusBadge.tsx

import { cn } from '@/lib/utils';
import { STAGE_DOT } from '@/lib/constants/statusColors';
import type { Stage } from '@/lib/constants/stages';

type Props = {
  status: Stage;
  size?:  'sm' | 'md';
};

// Control Room Status: an 8px stage-coloured dot + the stage name in ink.
export default function StatusBadge({ status, size = 'sm' }: Props) {
  return (
    <span className={cn(
      'inline-flex items-center gap-2 font-semibold whitespace-nowrap text-[#0C2A20]',
      size === 'sm' ? 'text-[13px]' : 'text-sm',
    )}>
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 rounded-full ring-[3px] ring-[#EEF2EF]"
        style={{ background: STAGE_DOT[status] ?? '#94A39B' }}
      />
      {status}
    </span>
  );
}
