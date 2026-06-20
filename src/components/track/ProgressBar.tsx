'use client';
// src/components/track/ProgressBar.tsx

import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { registerGsap } from '@/lib/gsap/register';
import { cn, getProgressBarState } from '@/lib/utils';
import type { Stage } from '@/lib/constants/stages';

registerGsap();

type Props = {
  percent: number;
  status:  Stage;
};

export default function ProgressBar({ percent, status }: Props) {
  const fill = useRef<HTMLDivElement>(null);
  const state = getProgressBarState(percent, status);

  const trackColor = {
    black:  'bg-white/10',
    orange: 'bg-amber-400/15',
    blue:   'bg-sky-400/15',
  }[state.color];

  const fillColor = {
    black:  'bg-emerald-400',
    orange: 'bg-amber-500',
    blue:   'bg-sky-500',
  }[state.color];

  useGSAP(() => {
    const el = fill.current;
    if (!el) return;
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () =>
      gsap.fromTo(el, { width: '0%' }, { width: `${percent}%`, duration: 1, ease: 'power2.out' }));
    mm.add('(prefers-reduced-motion: reduce)', () => gsap.set(el, { width: `${percent}%` }));
    return () => mm.revert();
  }, { dependencies: [percent], scope: fill });

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-[var(--glass-muted)]">{state.label}</span>
        <span className="text-xs font-mono text-[var(--glass-muted)]">{percent}%</span>
      </div>
      <div className={cn('h-2 rounded-full w-full', trackColor)}>
        <div
          ref={fill}
          className={cn('h-full rounded-full', fillColor)}
          style={{ width: '0%' }}
        />
      </div>
    </div>
  );
}
