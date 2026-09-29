// src/components/ui/FieldAffix.tsx
// Guidance for form fields that carry no placeholder (a sample value in
// the box reads as one already entered — see the EMPTY vs FILLED block
// in globals.css).
import React from 'react';
import { cn } from '@/lib/utils';

/** Pins a unit ("mm", "labels", "₹") inside the right edge of the one
 *  input it wraps. It names what goes in, never looks like a value. */
export function WithUnit({ unit, children, className }: {
  unit: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('relative [&>input]:pr-14', className)}>
      {children}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-[var(--glass-muted)]"
      >
        {unit}
      </span>
    </div>
  );
}

/** A worked example ("e.g. PO/2026/001") under the one field it wraps,
 *  shown only while that field has focus — so it never passes for data. */
export function WithExample({ example, children, className }: {
  /** Omit to render the field alone. */
  example?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      {children}
      {example && (
        <p className="field-example text-xs text-[var(--glass-muted)]">
          <span><span className="block pt-1.5">e.g. {example}</span></span>
        </p>
      )}
    </div>
  );
}
