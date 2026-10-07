'use client';
// src/components/admin/DiesTabs.tsx
// The Dies page holds two physical die types — rotary (DiesManager) and
// flatbed (FlatbedDiesManager) — behind one tab switcher, so the team keeps
// thinking of it as one die library with two sheets rather than two
// separate nav destinations.

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import DiesManager from './DiesManager';
import FlatbedDiesManager from './FlatbedDiesManager';

type Tab = 'roto' | 'flatbed';

const TABS: { value: Tab; label: string }[] = [
  { value: 'roto',    label: 'Roto Dies' },
  { value: 'flatbed', label: 'Flatbed Dies' },
];

export default function DiesTabs({ canManage }: { canManage: boolean }) {
  // ?tab=flatbed — the Ctrl K palette links a flatbed die straight to its sheet.
  const [tab, setTab] = useState<Tab>(useSearchParams().get('tab') === 'flatbed' ? 'flatbed' : 'roto');

  return (
    <div className="space-y-4">
      {/* Underline tabs — the same grammar as the dashboard's job views. */}
      <div role="tablist" aria-label="Die type" className="flex gap-7 border-b border-brand-border">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={tab === t.value}
            onClick={() => setTab(t.value)}
            className={cn(
              '-mb-px flex h-12 items-center border-b-2 px-0.5 text-sm transition-colors',
              tab === t.value
                ? 'border-brand-ink font-semibold text-brand-ink'
                : 'border-transparent font-medium text-brand-muted hover:text-brand-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'roto'
        ? <DiesManager canManage={canManage} />
        : <FlatbedDiesManager canManage={canManage} />}
    </div>
  );
}
