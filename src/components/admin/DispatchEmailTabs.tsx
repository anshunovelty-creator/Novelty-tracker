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
      {/* Solid white strip with a Press Green fill on the active tab —
          the same vocabulary as DiesTabs. The glass-* tokens flatten to
          near-white inside .admin-light, so a translucent strip on the
          mint wash reads as nothing at all. */}
      <div
        role="tablist"
        aria-label="Dispatch email sections"
        className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-black/[0.08] bg-white p-1"
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
                'min-h-11 whitespace-nowrap rounded-lg px-3.5 text-sm font-medium transition-colors',
                selected
                  ? 'bg-brand-primary text-white'
                  : 'text-[var(--glass-muted)] hover:bg-black/[0.04] hover:text-[var(--glass-ink)]',
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <p className="text-sm text-[var(--glass-muted)]">{current.caption}</p>

      <div id="dispatch-tabpanel" role="tabpanel" aria-labelledby={`dispatch-tab-${active}`}>
        {children}
      </div>
    </div>
  );
}
