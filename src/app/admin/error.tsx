'use client';
// src/app/admin/error.tsx
// Segment error boundary for the admin panel. Renders inside the admin
// shell, so the header and .admin-light theme are still present.

import { useEffect } from 'react';
import { RotateCw, ArrowLeft } from 'lucide-react';

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[admin] render error:', error);
  }, [error]);

  return (
    <div className="glass rounded-xl px-6 py-10 text-center max-w-lg mx-auto mt-8">
      <h1 className="text-lg font-semibold text-[var(--glass-ink)]">
        This screen didn&apos;t load
      </h1>
      <p className="mt-2 text-sm text-[var(--glass-muted)]">
        Something broke while loading your jobs. Nothing you entered has been
        lost — no job was changed by this error.
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
          href="/admin"
          className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-lg glass text-sm font-medium text-[var(--glass-ink)] transition-colors hover:bg-white/10"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          Back to dashboard
        </a>
      </div>

      {/* The digest is the only handle support has to find this in the logs. */}
      {error.digest && (
        <p className="mt-6 text-[11px] font-mono text-[var(--glass-muted)]">
          Reference: {error.digest}
        </p>
      )}
    </div>
  );
}
