'use client';
// src/components/admin/DiesTabs.tsx
// The Dies page holds two physical die types — rotary (DiesManager) and
// flatbed (FlatbedDiesManager) — behind one tab switcher, so the team keeps
// thinking of it as one die library with two sheets rather than two
// separate nav destinations.

import { useState } from 'react';
import { cn } from '@/lib/utils';
import DiesManager from './DiesManager';
import FlatbedDiesManager from './FlatbedDiesManager';

type Tab = 'roto' | 'flatbed';

const TABS: { value: Tab; label: string }[] = [
  { value: 'roto',    label: 'Roto Dies' },
  { value: 'flatbed', label: 'Flatbed Dies' },
];

export default function DiesTabs({ canManage }: { canManage: boolean }) {
  const [tab, setTab] = useState<Tab>('roto');

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Die type" className="inline-flex items-center gap-1 rounded-xl border border-black/[0.08] bg-white p-1">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={tab === t.value}
            onClick={() => setTab(t.value)}
            className={cn(
              'min-h-9 px-3.5 rounded-lg text-sm font-medium transition-colors',
              tab === t.value
                ? 'bg-brand-primary text-white'
                : 'text-[var(--glass-muted)] hover:text-[var(--glass-ink)] hover:bg-black/[0.04]',
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
