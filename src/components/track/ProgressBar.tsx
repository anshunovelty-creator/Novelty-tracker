'use client';
// src/components/track/ProgressBar.tsx

import { cn, getProgressBarState } from '@/lib/utils';
import type { Stage } from '@/lib/constants/stages';

type Props = {
  percent: number;
  status:  Stage;
};

export default function ProgressBar({ percent, status }: Props) {
  const state = getProgressBarState(percent, status);

  const trackColor = {
    black:  'bg-brand-bg',
    orange: 'bg-amber-100',
    blue:   'bg-sky-100',
  }[state.color];

  const fillColor = {
    black:  'bg-brand-primary',
    orange: 'bg-amber-500',
    blue:   'bg-sky-500',
  }[state.color];

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-brand-muted">{state.label}</span>
        <span className="text-xs font-mono text-brand-muted">{percent}%</span>
      </div>
      <div className={cn('h-2 rounded-full w-full', trackColor)}>
        <div
          className={cn('h-full rounded-full transition-all duration-500', fillColor)}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
    </div>
  );
}
