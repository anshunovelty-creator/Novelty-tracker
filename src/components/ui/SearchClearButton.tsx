'use client';
// src/components/ui/SearchClearButton.tsx
// The × at the right end of a search field. Renders nothing while the field is
// empty, so it only appears once there is something to clear.
//
// Place it inside the field's `relative` wrapper, after the <input>, and give
// the input right padding (pr-11, or pr-9 for size="sm") so typed text never
// runs under it. Clearing hands focus back to the input — the next thing
// anyone does after clearing a search is type a new one.

import React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  /** The field's current text — the button hides while this is empty. */
  value:   string;
  onClear: () => void;
  /** 'sm' for the compact fields in side panels. */
  size?:   'md' | 'sm';
  className?: string;
};

export function SearchClearButton({ value, onClear, size = 'md', className }: Props) {
  if (!value) return null;

  return (
    <button
      type="button"
      onClick={(e) => {
        onClear();
        e.currentTarget.parentElement?.querySelector('input')?.focus();
      }}
      aria-label="Clear search"
      title="Clear search"
      className={cn(
        'absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center justify-center rounded-lg',
        'text-[var(--glass-muted)] hover:text-[var(--glass-ink)] transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70',
        size === 'sm' ? 'min-h-8 min-w-8' : 'min-h-11 min-w-11',
        className,
      )}
    >
      <X className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden="true" />
    </button>
  );
}
