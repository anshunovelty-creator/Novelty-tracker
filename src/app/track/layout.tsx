// src/app/track/layout.tsx
import React from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Logo } from '@/components/brand/Logo';
import { AuroraBackground } from '@/components/motion/AuroraBackground';

export const metadata: Metadata = {
  title: 'Order Tracking | Novelty Labels',
  description: 'Track your label printing order status with Novelty Labels & Supplies.',
  robots: { index: true, follow: false },
};

export default function TrackLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-header via-[#0C4232] to-[#082F24] text-green-100">
      {/* Minimal branded header */}
      <header className="bg-brand-header border-b border-white/10">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/track" className="flex items-center gap-2">
            <Logo onDark width={132} height={34} priority />
          </Link>
          <span className="text-white/40 text-xs">Order Tracking</span>
        </div>
      </header>

      <main className="relative max-w-2xl mx-auto px-4 py-8">
        <AuroraBackground />
        {children}
      </main>

      <footer className="mt-16 pb-8 text-center">
        <p className="text-xs text-green-300/70">
          Novelty Labels &amp; Supplies · Ankleshwar GIDC, Gujarat
        </p>
      </footer>
    </div>
  );
}
