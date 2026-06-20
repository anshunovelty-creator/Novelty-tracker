'use client';
// src/components/ui/Loading.tsx
import React, { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-block h-4 w-4 flex-none rounded-full border-2 border-white/35 border-t-emerald-200 animate-spin',
        className,
      )}
    />
  );
}

/** Fades through stages every `interval` ms. Static (first stage) under reduced motion. */
export function CyclingText({
  stages,
  interval = 1800,
  className,
}: {
  stages: string[];
  interval?: number;
  className?: string;
}) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (stages.length <= 1) return;
    if (typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setI((p) => (p + 1) % stages.length), interval);
    return () => clearInterval(t);
  }, [stages.length, interval]);
  return (
    <span key={i} className={cn('cyc-fade', className)}>
      {stages[i] ?? stages[0]}
    </span>
  );
}

type LoadingButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  loadingStages?: string[];
};

export function LoadingButton({
  loading = false,
  loadingStages = ['Working…'],
  children,
  className,
  disabled,
  ...rest
}: LoadingButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={cn('inline-flex items-center justify-center gap-2', className)}
      {...rest}
    >
      {loading ? (
        <>
          <Spinner />
          <CyclingText stages={loadingStages} />
        </>
      ) : (
        children
      )}
    </button>
  );
}
