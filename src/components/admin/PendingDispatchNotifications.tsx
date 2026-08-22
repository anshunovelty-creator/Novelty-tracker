'use client';
// src/components/admin/PendingDispatchNotifications.tsx
// One card per party with pending dispatch events. Internal team and party
// are notified independently — the team typically sends internal first,
// checks it, then sends the party's copy some time later. Only the party
// send clears the card off this list; the internal send just marks it
// notified (shown as a small badge) so the card stays until the party
// copy actually goes out.

import { useState, useEffect, useCallback } from 'react';
import { Send, Mail, PackageCheck, Plus, Pencil, Trash2, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, formatAdminDate } from '@/lib/utils';
import type { PendingDispatchGroup, PendingDispatchNotification } from '@/lib/types';
import AddCustomDispatchModal from './AddCustomDispatchModal';

type SendTarget = 'internal' | 'party';

export default function PendingDispatchNotifications() {
  const [groups,  setGroups]  = useState<PendingDispatchGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendingKey, setSendingKey] = useState<string | null>(null);
  const [modalItem, setModalItem] = useState<PendingDispatchNotification | 'new' | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  async function removeItem(item: PendingDispatchNotification) {
    setDeletingId(item.id);
    try {
      const res  = await fetch(`/api/dispatch-notifications/${item.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to remove entry');
        return;
      }
      setGroups((prev) => prev
        .map((g) => (g.party === item.party ? { ...g, items: g.items.filter((i) => i.id !== item.id) } : g))
        .filter((g) => g.items.length > 0));
      toast.success('Entry removed');
    } catch {
      toast.error('Network error');
    } finally {
      setDeletingId(null);
    }
  }

  async function sendFor(party: string, target: SendTarget) {
    const key = `${party}:${target}`;
    setSendingKey(key);
    try {
      const res  = await fetch('/api/dispatch-notifications/send', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ party, target }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to send');
        return;
      }
      if (data.skipped) {
        toast.error('Nothing pending for this party anymore');
        return;
      }

      const audience = target === 'party' ? 'party' : 'internal team';
      const delivered = target === 'party' ? data.sent_to_party : data.sent_to_internal;
      toast.success(
        delivered
          ? `Sent to ${audience} — ${data.item_count} item${data.item_count === 1 ? '' : 's'}`
          : `Marked sent (no ${audience === 'party' ? 'contact' : 'recipients'} on file to actually deliver to)`,
      );

      if (target === 'party') {
        setGroups((prev) => prev.filter((g) => g.party !== party));
      } else {
        const now = new Date().toISOString();
        setGroups((prev) => prev.map((g) => (
          g.party === party
            ? { ...g, items: g.items.map((i) => ({ ...i, internal_notified_at: now })) }
            : g
        )));
      }
    } catch {
      toast.error('Network error');
    } finally {
      setSendingKey(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        {!loading ? (
          <p className="text-sm text-[var(--glass-muted)]">
            <strong className="text-[var(--glass-ink)]">{groups.length}</strong>
            {' '}{groups.length === 1 ? 'party' : 'parties'} with unsent dispatches
          </p>
        ) : <span />}
        <button
          onClick={() => setModalItem('new')}
          className={cn(
            'inline-flex items-center justify-center gap-1.5 min-h-11 px-4 rounded-xl shrink-0',
            'text-sm font-medium text-[var(--glass-ink)] border border-black/[0.12] hover:bg-black/[0.04]',
            'transition-colors whitespace-nowrap',
          )}
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          Custom entry
        </button>
      </div>

      {modalItem && (
        <AddCustomDispatchModal
          existing={modalItem === 'new' ? null : modalItem}
          onClose={() => setModalItem(null)}
          onSaved={() => { setModalItem(null); load(); }}
        />
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
                  {group.items.every((i) => i.internal_notified_at) && (
                    <p className="flex items-center gap-1 text-xs text-emerald-700 mt-1">
                      <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                      Internal team notified
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => sendFor(group.party, 'internal')}
                    disabled={sendingKey !== null}
                    className={cn(
                      'inline-flex items-center justify-center gap-1.5 min-h-11 px-3.5 rounded-xl',
                      'text-sm font-medium text-[var(--glass-ink)] border border-black/[0.12] hover:bg-black/[0.04]',
                      'disabled:opacity-40 transition-colors whitespace-nowrap',
                    )}
                  >
                    <Mail className="w-4 h-4" aria-hidden="true" />
                    {sendingKey === `${group.party}:internal` ? 'Sending…' : 'Send to Team'}
                  </button>
                  <button
                    onClick={() => sendFor(group.party, 'party')}
                    disabled={sendingKey !== null}
                    className={cn(
                      'inline-flex items-center justify-center gap-1.5 min-h-11 px-3.5 rounded-xl',
                      'text-sm font-medium bg-brand-primary text-white hover:bg-brand-primary/90',
                      'disabled:opacity-40 transition-colors whitespace-nowrap',
                    )}
                  >
                    <Send className="w-4 h-4" aria-hidden="true" />
                    {sendingKey === `${group.party}:party` ? 'Sending…' : 'Send to Party'}
                  </button>
                </div>
              </div>

              <ul className="space-y-1.5 border-t border-black/[0.06] pt-3">
                {group.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs"
                  >
                    <span className="text-[var(--glass-ink)] font-medium">
                      {item.job_name ?? item.po_number}
                      <span className="text-[var(--glass-muted)] font-normal font-mono ml-1.5">
                        {item.po_number}
                        {item.pm_code ? ` · PM: ${item.pm_code}` : ''}
                      </span>
                    </span>
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      <span className="text-[var(--glass-muted)]">
                        {item.status === 'Partial Dispatch' ? 'Partial — ' : ''}
                        {item.qty ? `${item.qty.toLocaleString('en-IN')} labels` : '—'}
                        {' · '}
                        <span className="font-mono">{formatAdminDate(item.created_at)}</span>
                      </span>
                      <button
                        onClick={() => setModalItem(item)}
                        aria-label={`Edit entry for ${item.po_number}`}
                        className="inline-flex items-center justify-center min-h-11 min-w-11 rounded-lg text-[var(--glass-muted)] hover:text-[var(--glass-ink)] hover:bg-black/[0.05] transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                      <button
                        onClick={() => removeItem(item)}
                        disabled={deletingId === item.id}
                        aria-label={`Remove entry for ${item.po_number}`}
                        className="inline-flex items-center justify-center min-h-11 min-w-11 rounded-lg text-[var(--glass-muted)] hover:text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
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
