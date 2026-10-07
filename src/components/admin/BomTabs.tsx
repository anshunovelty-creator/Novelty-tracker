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

export default function BomTabs({ canDecide, canManageStock, canSeeTotals }: { canDecide: boolean; canManageStock: boolean; canSeeTotals: boolean }) {
  // Costing first for everyone — "is this order worth taking" is the
  // question the section exists to answer; the Requests badge flags the
  // rest.
  const [tab, setTab] = useState<Tab>('costing');

  // Same live count as the header badge (one query, one Realtime channel),
  // so both update together when a request is raised or answered.
  const pending = useBomPendingCount();

  return (
    <div className="space-y-4">
      {/* Underline tabs — the same grammar as DiesTabs and the dashboard. */}
      <div role="tablist" aria-label="Bill of Material section" className="flex gap-7 overflow-x-auto overflow-y-hidden border-b border-brand-border">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={tab === t.value}
            onClick={() => setTab(t.value)}
            className={cn(
              'flex h-12 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-0.5 text-sm transition-colors',
              tab === t.value
                ? 'border-brand-ink font-semibold text-brand-ink'
                : 'border-transparent font-medium text-brand-muted hover:text-brand-ink',
            )}
          >
            {t.label}
            {t.value === 'requests' && pending > 0 && (
              <span
                className="rounded-full bg-brand-sunken px-[7px] py-px font-mono text-xs font-medium tabular-nums text-brand-warning"
                aria-label={`${pending} awaiting`}
              >
                {pending}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'costing'   && <BomCostingTable canDecide={canDecide} canSeeTotals={canSeeTotals} />}
      {tab === 'requests'  && <BomRequestsList canDecide={canDecide} canManageStock={canManageStock} />}
      {tab === 'inventory' && <PaperStockManager canManage={canManageStock} canSeeTotals={canSeeTotals} />}
      {tab === 'materials' && <BomMaterialsManager canManage={canDecide} />}
    </div>
  );
}
