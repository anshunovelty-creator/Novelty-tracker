// src/app/track/layout.tsx
import React from 'react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Order Tracking | Novelty Labels',
  description: 'Track your label printing order status with Novelty Labels & Supplies.',
  robots: { index: true, follow: false },
};

export default function TrackLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-brand-bg">
      {/* Minimal branded header */}
      <header className="bg-brand-header border-b border-white/10">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-white/10 rounded-md flex items-center justify-center">
              <span className="text-white text-xs font-bold">N</span>
            </div>
            <span className="text-white font-semibold text-sm">Novelty Labels</span>
          </div>
          <span className="text-white/40 text-xs">Order Tracking</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        {children}
      </main>

      <footer className="mt-16 pb-8 text-center">
        <p className="text-xs text-brand-muted">
          Novelty Labels &amp; Supplies · Ankleshwar GIDC, Gujarat
        </p>
      </footer>
    </div>
  );
}
