'use client';
// src/components/admin/BomTabs.tsx
// Bill of Material's three sheets behind one tab switcher, the way Dies
// holds roto and flatbed: Costing (the order-vs-material comparison, where
// the floor works), Requests (the owner's inbox), Materials (the master
// list with rates). Same pattern as DiesTabs so the team keeps thinking of
// it as one section.
//
// The Requests tab carries the pending count — the same number the nav
// badge shows — so the owner landing on Costing still sees there's
// something waiting.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import BomCostingTable from './BomCostingTable';
import BomRequestsList from './BomRequestsList';
import BomMaterialsManager from './BomMaterialsManager';

type Tab = 'costing' | 'requests' | 'materials';

const TABS: { value: Tab; label: string }[] = [
  { value: 'costing',   label: 'Costing' },
  { value: 'requests',  label: 'Requests' },
  { value: 'materials', label: 'Materials' },
];

export default function BomTabs({ canDecide }: { canDecide: boolean }) {
  // Costing first for everyone — "is this order worth taking" is the
  // question the section exists to answer; the Requests badge flags the
  // rest.
  const [tab, setTab] = useState<Tab>('costing');

  // Shares the header badge's query key, so the count is fetched once and
  // both places update together when a request is raised or answered.
  const { data: pending = 0 } = useQuery({
    queryKey: ['bom-requests', 'pending-count'],
    queryFn: async () => {
      const res = await fetch('/api/bom-requests?count=pending');
      if (!res.ok) throw new Error('Failed to load pending count');
      const data = await res.json();
      return (data.pending ?? 0) as number;
    },
  });

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Bill of Material section" className="inline-flex items-center gap-1 rounded-xl border border-black/[0.08] bg-white p-1">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={tab === t.value}
            onClick={() => setTab(t.value)}
            className={cn(
              'inline-flex items-center gap-1.5 min-h-9 px-3.5 rounded-lg text-sm font-medium transition-colors',
              tab === t.value
                ? 'bg-brand-primary text-white'
                : 'text-[var(--glass-muted)] hover:text-[var(--glass-ink)] hover:bg-black/[0.04]',
            )}
          >
            {t.label}
            {t.value === 'requests' && pending > 0 && (
              <span
                className={cn(
                  'inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums',
                  tab === t.value ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-800',
                )}
                aria-label={`${pending} awaiting`}
              >
                {pending}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'costing'   && <BomCostingTable canDecide={canDecide} />}
      {tab === 'requests'  && <BomRequestsList canDecide={canDecide} />}
      {tab === 'materials' && <BomMaterialsManager canManage={canDecide} />}
    </div>
  );
}
