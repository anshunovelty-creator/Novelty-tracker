'use client';
// src/app/admin/not-found.tsx
// The admin-shell 404. Rendered inside AdminLayout, so it inherits the
// .admin-light shell (header, mint wash) automatically; no GSAP here, to
// match the rest of the admin panel, which stays plain and fast.
//
// WHEN THIS ACTUALLY RENDERS — and when it does not
// A nested not-found only answers an explicit notFound() call from a route
// inside its own segment. A merely mistyped /admin/... URL matches no route
// at all, so the App Router falls all the way back to the ROOT
// app/not-found.tsx (the dark-mesh public one) and never reaches this file.
//
// Nothing under /admin calls notFound() yet, so today this is staged rather
// than live. The obvious first caller is admin/jobs/[id], which currently
// hand-rolls its own "Job not found" block instead: switching that to
// notFound() would route it here and delete the duplicate.
//
// 'use client' is load-bearing, not habit: buttonClass is exported from
// Button.tsx, which is a client module. Imported into a server component it
// arrives as a client-reference proxy rather than the function, and calling
// it throws "buttonClass is not a function" at render — a crash nobody sees
// until someone actually mistypes an /admin URL.

import Link from 'next/link';
import { buttonClass } from '@/components/ui/Button';

export default function AdminNotFound() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="rounded-2xl border border-black/[0.08] bg-white p-8 sm:p-10 text-center max-w-md w-full shadow-[0_2px_8px_rgba(12,42,32,0.05)]">
        {/* Same "no signal" motif as the public 404, retuned to Press Green
            for the light shell instead of the dark mesh's emerald. */}
        <div className="relative mx-auto mb-6 h-20 w-20" aria-hidden="true">
          <span className="signal-ping absolute inset-0 rounded-full border border-[#10553F]/25" />
          <span
            className="signal-ping absolute inset-0 rounded-full border border-[#10553F]/25"
            style={{ animationDelay: '-1.2s' }}
          />
          <span className="absolute inset-[22%] rounded-full bg-[#F4F8F5] border border-black/[0.08] flex items-center justify-center">
            <span className="font-mono text-sm text-[#10553F]">?</span>
          </span>
        </div>

        <p className="text-xs font-mono uppercase tracking-wide text-[var(--glass-muted)]">
          Error 404
        </p>
        <h1 className="mt-2 text-xl font-semibold text-[var(--glass-ink)]">
          We couldn&apos;t find that page
        </h1>
        <p className="mt-2 text-sm text-[var(--glass-muted)]">
          The URL may be mistyped, or the page has moved. Check the sidebar
          for what you were looking for, or head back to the dashboard.
        </p>

        <div className="mt-6 flex flex-col sm:flex-row gap-2 justify-center">
          <Link href="/admin" className={buttonClass('primary', 'md')}>
            Go to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
