'use client';
// src/components/admin/PendingDispatchNotifications.tsx
// One card per party with pending dispatch events — "Send" fires one
// consolidated email (client + internal team) covering every item queued
// for that party, then clears them off this list.

import { useState, useEffect, useCallback } from 'react';
import { Send, PackageCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, formatAdminDate } from '@/lib/utils';
import type { PendingDispatchGroup } from '@/lib/types';

export default function PendingDispatchNotifications() {
  const [groups,  setGroups]  = useState<PendingDispatchGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendingParty, setSendingParty] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/dispatch-notifications');
      const data = await res.json();
      if (res.ok) setGroups(data.groups ?? []);
      else toast.error(data.error ?? 'Failed to load pending dispatches');
    } catch {
      toast.error('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function sendFor(party: string) {
    setSendingParty(party);
    try {
      const res  = await fetch('/api/dispatch-notifications/send', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ party }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to send');
        return;
      }
      if (data.skipped) {
        toast.error('Nothing pending for this party anymore');
      } else {
        const parts: string[] = [];
        if (data.sent_to_party)    parts.push('party');
        if (data.sent_to_internal) parts.push('internal team');
        toast.success(
          parts.length > 0
            ? `Sent to ${parts.join(' and ')} — ${data.item_count} item${data.item_count === 1 ? '' : 's'}`
            : 'Marked sent (no recipients on file to actually deliver to)',
        );
      }
      setGroups((prev) => prev.filter((g) => g.party !== party));
    } catch {
      toast.error('Network error');
    } finally {
      setSendingParty(null);
    }
  }

  return (
    <div className="space-y-3">
      {!loading && (
        <p className="text-sm text-[var(--glass-muted)]">
          <strong className="text-[var(--glass-ink)]">{groups.length}</strong>
          {' '}{groups.length === 1 ? 'party' : 'parties'} with unsent dispatches
        </p>
      )}

      {loading ? (
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-black/[0.04]" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center rounded-xl border border-black/[0.08] bg-white px-4 py-12">
          <PackageCheck className="w-6 h-6 text-[var(--glass-muted)]" aria-hidden="true" />
          <p className="text-sm font-medium text-[var(--glass-ink)] mt-3">Nothing pending.</p>
          <p className="text-xs text-[var(--glass-muted)] mt-1">
            Every dispatched job so far has had its email sent.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {groups.map((group) => (
            <li
              key={group.party}
              className="rounded-xl border border-black/[0.08] bg-white p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--glass-ink)]">{group.party}</p>
                  <p className="text-xs text-[var(--glass-muted)] mt-0.5">
                    {group.items.length} item{group.items.length === 1 ? '' : 's'} queued
                  </p>
                </div>
                <button
                  onClick={() => sendFor(group.party)}
                  disabled={sendingParty === group.party}
                  className={cn(
                    'inline-flex items-center justify-center gap-1.5 min-h-11 px-4 rounded-xl shrink-0',
                    'text-sm font-medium bg-brand-primary text-white hover:bg-brand-primary/90',
                    'disabled:opacity-40 transition-colors whitespace-nowrap',
                  )}
                >
                  <Send className="w-4 h-4" aria-hidden="true" />
                  {sendingParty === group.party ? 'Sending…' : 'Send'}
                </button>
              </div>

              <ul className="space-y-1.5 border-t border-black/[0.06] pt-3">
                {group.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-xs"
                  >
                    <span className="text-[var(--glass-ink)] font-medium">
                      {item.job_name ?? item.po_number}
                      <span className="text-[var(--glass-muted)] font-normal font-mono ml-1.5">
                        {item.po_number}
                      </span>
                    </span>
                    <span className="text-[var(--glass-muted)] whitespace-nowrap">
                      {item.status === 'Partial Dispatch' ? 'Partial — ' : ''}
                      {item.qty ? `${item.qty.toLocaleString('en-IN')} labels` : '—'}
                      {' · '}
                      <span className="font-mono">{formatAdminDate(item.created_at)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
