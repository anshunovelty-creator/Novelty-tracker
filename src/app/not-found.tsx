'use client';
// src/app/not-found.tsx
// 404 for unmatched routes and for any notFound() call — most often an
// unknown PO number on the public portal, so the copy leads with that.
//
// This renders directly under the root layout (outside .admin-light and
// outside /track's own chrome), so it carries its own dark mesh atmosphere
// rather than sitting on the light admin body background — otherwise the
// dark-glass text tokens end up light-on-light and unreadable.

import { useRef } from 'react';
import Link from 'next/link';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { registerGsap } from '@/lib/gsap/register';
import { GradientMesh } from '@/components/motion/GradientMesh';
import { buttonClass } from '@/components/ui/Button';
registerGsap();

export default function NotFound() {
  const cardRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const el = cardRef.current;
    if (!el) return;
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () =>
      gsap.fromTo(el, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }));
    mm.add('(prefers-reduced-motion: reduce)', () => gsap.set(el, { opacity: 1, y: 0 }));
    return () => mm.revert();
  }, { scope: cardRef });

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
      <GradientMesh />

      <div
        ref={cardRef}
        className="glass rounded-2xl px-8 py-10 text-center max-w-md w-full shadow-[0_8px_30px_rgba(0,0,0,0.18)]"
      >
        {/* "No signal" glyph — a sonar ping that fades without ever finding
            a blip, standing in for a literal "page not found" illustration
            without breaking the no-external-assets, no-marketing-motion rule. */}
        <div className="relative mx-auto mb-6 h-20 w-20" aria-hidden="true">
          <span className="signal-ping absolute inset-0 rounded-full border border-emerald-300/40" />
          <span
            className="signal-ping absolute inset-0 rounded-full border border-emerald-300/40"
            style={{ animationDelay: '-1.2s' }}
          />
          <span className="glass-strong absolute inset-[22%] rounded-full border border-[var(--glass-border)] flex items-center justify-center">
            <span className="font-mono text-sm text-emerald-200">?</span>
          </span>
        </div>

        <p className="text-xs font-mono uppercase tracking-wide text-[var(--glass-muted)]">
          Error 404
        </p>
        <h1 className="mt-2 text-xl font-semibold text-[var(--glass-ink)]">
          We couldn&apos;t find that page
        </h1>
        <p className="mt-2 text-sm text-[var(--glass-muted)]">
          If you were looking up an order, double-check the PO number — it may
          have been typed differently, or not been entered into the system yet.
        </p>

        <div className="mt-6 flex flex-col sm:flex-row gap-2 justify-center">
          <Link href="/track" className={buttonClass('primary', 'md')}>
            Track an order
          </Link>
          <Link href="/admin" className={buttonClass('ghost', 'md')}>
            Go to admin
          </Link>
        </div>
      </div>
    </div>
  );
}
