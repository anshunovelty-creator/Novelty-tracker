'use client';
// src/app/track/page.tsx

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Reveal } from '@/components/motion/Reveal';

export default function TrackPage() {
  const router = useRouter();
  const [po, setPo] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = po.trim();
    if (!cleaned) return;
    router.push(`/track/${encodeURIComponent(cleaned)}`);
  }

  return (
    <div className="flex flex-col items-center pt-8">
      <Reveal className="text-center">
        <h1 className="text-3xl font-semibold text-white tracking-tight mb-2 text-center">
          Track Your Order
        </h1>
        <p className="text-green-200 text-sm text-center mb-8">
          Enter your Purchase Order number or Job Name to see the current status.
        </p>
      </Reveal>

      <Reveal delay={0.1} className="w-full max-w-md">
      <form
        onSubmit={handleSubmit}
        className="space-y-3"
      >
        <input
          type="text"
          value={po}
          onChange={(e) => setPo(e.target.value)}
          placeholder="Enter PO Number or Job Name"
          className={cn(
            'w-full px-4 py-3 rounded-xl border text-base',
            'bg-white border-brand-border text-brand-accent',
            'placeholder:text-brand-muted',
            'focus:outline-none focus:ring-2 focus:ring-brand-accent/20 focus:border-brand-accent',
            'transition-colors font-mono tracking-wide'
          )}
        />
        <button
          type="submit"
          disabled={!po.trim()}
          className={cn(
            'w-full bg-brand-primary text-white py-3 rounded-xl text-sm font-medium',
            'hover:bg-brand-primary/90 transition-colors',
            'disabled:opacity-40 disabled:cursor-not-allowed'
          )}
        >
          Track Order →
        </button>
      </form>
      </Reveal>

      <p className="mt-8 text-xs text-green-200 text-center">
        Can't find your order? Contact us at{' '}
        <a href="mailto:orders@noveltylabels.com" className="underline">
          orders@noveltylabels.com
        </a>
      </p>
    </div>
  );
}
