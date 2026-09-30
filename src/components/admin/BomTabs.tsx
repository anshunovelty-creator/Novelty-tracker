'use client';
// src/components/admin/BomTabs.tsx
// Bill of Material's four sheets behind one tab switcher, the way Dies
// holds roto and flatbed: Costing (the order-vs-material comparison, where
// the floor works), Requests (the owner's inbox), Inventory (paper rolls on
// the rack), Materials (the master list with rates). Same pattern as DiesTabs so the team keeps thinking of
// it as one section.
//
// The Requests tab carries the pending count — the same number the nav
// badge shows — so the owner landing on Costing still sees there's
// something waiting.

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useBomPendingCount } from '@/hooks/useBadgeCounts';
import BomCostingTable from './BomCostingTable';
import BomRequestsList from './BomRequestsList';
import BomMaterialsManager from './BomMaterialsManager';
import PaperStockManager from './PaperStockManager';

type Tab = 'costing' | 'requests' | 'inventory' | 'materials';

const TABS: { value: Tab; label: string }[] = [
  { value: 'costing',   label: 'Costing' },
  { value: 'requests',  label: 'Requests' },
  { value: 'inventory', label: 'Inventory' },
  { value: 'materials', label: 'Materials' },
];

export default function BomTabs({ canDecide, canManageStock }: { canDecide: boolean; canManageStock: boolean }) {
  // Costing first for everyone — "is this order worth taking" is the
  // question the section exists to answer; the Requests badge flags the
  // rest.
  const [tab, setTab] = useState<Tab>('costing');

  // Same live count as the header badge (one query, one Realtime channel),
  // so both update together when a request is raised or answered.
  const pending = useBomPendingCount();

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
      {tab === 'requests'  && <BomRequestsList canDecide={canDecide} canManageStock={canManageStock} />}
      {tab === 'inventory' && <PaperStockManager canManage={canManageStock} />}
      {tab === 'materials' && <BomMaterialsManager canManage={canDecide} />}
    </div>
  );
}
