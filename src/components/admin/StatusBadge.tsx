'use client';
// src/components/admin/StatusBadge.tsx

import { cn } from '@/lib/utils';
import { STATUS_COLORS } from '@/lib/constants/statusColors';
import type { Stage } from '@/lib/constants/stages';

type Props = {
  status: Stage;
  size?:  'sm' | 'md';
};

export default function StatusBadge({ status, size = 'sm' }: Props) {
  const colors = STATUS_COLORS[status] ?? { bg: 'bg-gray-100', text: 'text-gray-700', border: 'border border-gray-200' };
  return (
    <span className={cn(
      'inline-flex items-center rounded-full font-medium',
      size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-3 py-1',
      colors.bg,
      colors.text,
      colors.border
    )}>
      {status}
    </span>
  );
}
