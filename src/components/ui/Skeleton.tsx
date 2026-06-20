// src/components/ui/Skeleton.tsx
import { cn } from '@/lib/utils';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} />;
}

/** A few shimmer lines for text blocks. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  const widths = ['w-3/5', 'w-11/12', 'w-3/4', 'w-5/6', 'w-2/3'];
  return (
    <div className={cn('space-y-2.5', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn('h-3', widths[i % widths.length])} />
      ))}
    </div>
  );
}

/** Skeleton rows for tables — render inside a tbody with the given column count. */
export function SkeletonRows({ rows = 4, cols = 8 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r}>
          {Array.from({ length: cols }).map((__, c) => (
            <td key={c} className="px-4 py-3"><Skeleton className="h-3 w-full" /></td>
          ))}
        </tr>
      ))}
    </>
  );
}
