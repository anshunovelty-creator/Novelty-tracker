'use client';

// src/components/admin/DispatchEmailTabs.tsx
// Tab shell for /admin/dispatch-notifications. The queue and the two
// recipient lists are all facets of one dispatch email — the party copy
// and the internal team copy — so they live on one page instead of three
// nav entries. /admin/party-contacts and /admin/notifications redirect in
// here.
//
// Which tabs exist is decided on the server (three independently grantable
// feature keys) and passed in; this component only renders what it's given,
// so a department never sees a tab it can't use.

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { cn } from '@/lib/utils';

export type DispatchTabId = 'queue' | 'parties' | 'team';

export type DispatchTab = {
  id:      DispatchTabId;
  label:   string;
  caption: string;   // one-line explanation shown under the tab strip
};

export default function DispatchEmailTabs({
  tabs,
  active,
  children,
}: {
  tabs:     DispatchTab[];
  active:   DispatchTabId;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const params = useSearchParams();

  const select = useCallback((id: DispatchTabId) => {
    const next = new URLSearchParams(params.toString());
    // The default tab reads cleaner without a query string on it.
    if (id === tabs[0]?.id) next.delete('tab');
    else next.set('tab', id);
    const qs = next.toString();
    router.replace(qs ? `/admin/dispatch-notifications?${qs}` : '/admin/dispatch-notifications', { scroll: false });
  }, [params, router, tabs]);

  // A lone tab is not a choice — don't render a strip for it.
  if (tabs.length < 2) return <>{children}</>;

  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  return (
    <div className="space-y-4">
      {/* Underline tabs — the same grammar as DiesTabs and the dashboard's
          job views. */}
      <div
        role="tablist"
        aria-label="Dispatch email sections"
        className="flex gap-7 overflow-x-auto overflow-y-hidden border-b border-brand-border"
      >
        {tabs.map((tab) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`dispatch-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls="dispatch-tabpanel"
              onClick={() => select(tab.id)}
              className={cn(
                '-mb-px flex h-12 shrink-0 items-center whitespace-nowrap border-b-2 px-0.5 text-sm transition-colors',
                selected
                  ? 'border-brand-ink font-semibold text-brand-ink'
                  : 'border-transparent font-medium text-brand-muted hover:text-brand-ink',
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <p className="text-sm text-brand-muted">{current.caption}</p>

      <div id="dispatch-tabpanel" role="tabpanel" aria-labelledby={`dispatch-tab-${active}`}>
        {children}
      </div>
    </div>
  );
}
