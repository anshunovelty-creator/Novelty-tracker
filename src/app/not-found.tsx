// src/app/not-found.tsx
// 404 for unmatched routes and for any notFound() call — most often an
// unknown PO number on the public portal, so the copy leads with that.

import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="glass rounded-2xl px-6 py-10 text-center max-w-md w-full">
        <p className="text-xs font-mono uppercase tracking-wide text-[var(--glass-muted)]">
          404
        </p>
        <h1 className="mt-2 text-xl font-semibold text-[var(--glass-ink)]">
          We couldn&apos;t find that page
        </h1>
        <p className="mt-2 text-sm text-[var(--glass-muted)]">
          If you were looking up an order, double-check the PO number — it may
          have been typed differently, or not been entered into the system yet.
        </p>

        <div className="mt-6 flex flex-col sm:flex-row gap-2 justify-center">
          <Link
            href="/track"
            className="inline-flex items-center justify-center min-h-[44px] px-4 rounded-lg bg-brand-primary text-white text-sm font-medium transition-opacity hover:opacity-90"
          >
            Track an order
          </Link>
          <Link
            href="/admin"
            className="inline-flex items-center justify-center min-h-[44px] px-4 rounded-lg glass text-sm font-medium text-[var(--glass-ink)] transition-colors hover:bg-white/10"
          >
            Go to admin
          </Link>
        </div>
      </div>
    </div>
  );
}
