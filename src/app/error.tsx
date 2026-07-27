'use client';
// src/app/error.tsx
// Root error boundary — catches throws in segments that have no boundary
// of their own (/login, /display). The admin and track segments define
// their own, more specific, versions.

import { useEffect } from 'react';
import { RotateCw } from 'lucide-react';

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[root] render error:', error);
  }, [error]);

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="glass rounded-2xl px-6 py-10 text-center max-w-md w-full">
        <h1 className="text-xl font-semibold text-[var(--glass-ink)]">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-[var(--glass-muted)]">
          This page failed to load. No job data was changed.
        </p>

        <button
          onClick={reset}
          className="mt-6 inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-lg bg-brand-primary text-white text-sm font-medium transition-opacity hover:opacity-90"
        >
          <RotateCw className="w-4 h-4" aria-hidden="true" />
          Try again
        </button>

        {error.digest && (
          <p className="mt-6 text-[11px] font-mono text-[var(--glass-muted)]">
            Reference: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
