'use client';
// src/app/track/error.tsx
// Error boundary for the public tracking portal. This is a client-facing
// brand surface, so the copy carries no internal detail and always leaves
// the visitor a next step.

import { useEffect } from 'react';
import { RotateCw, Search } from 'lucide-react';

export default function TrackError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[track] render error:', error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="glass rounded-2xl px-6 py-10 text-center max-w-md w-full">
        <h1 className="text-xl font-semibold text-[var(--glass-ink)]">
          We couldn&apos;t load your order
        </h1>
        <p className="mt-2 text-sm text-[var(--glass-muted)]">
          This is a problem on our side, not with your order. Your job is safe
          and unchanged — please try again in a moment.
        </p>

        <div className="mt-6 flex flex-col sm:flex-row gap-2 justify-center">
          <button
            onClick={reset}
            className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-lg bg-brand-primary text-white text-sm font-medium transition-opacity hover:opacity-90"
          >
            <RotateCw className="w-4 h-4" aria-hidden="true" />
            Try again
          </button>
          <a
            href="/track"
            className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-lg glass text-sm font-medium text-[var(--glass-ink)] transition-colors hover:bg-white/10"
          >
            <Search className="w-4 h-4" aria-hidden="true" />
            Search another PO
          </a>
        </div>

        {error.digest && (
          <p className="mt-6 text-[11px] font-mono text-[var(--glass-muted)]">
            If you contact us, quote reference {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
