'use client';
// src/components/admin/NotificationRecipientsManager.tsx
// Internal team emails that get a copy of the consolidated dispatch email
// sent from /admin/dispatch-notifications (POST /api/dispatch-notifications/send).
// Mirrors TeamManager's list/add/remove shape.

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Bell } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, formatAdminDate } from '@/lib/utils';
import type { InternalNotificationRecipient } from '@/lib/types';
import AddRecipientModal from './AddRecipientModal';

export default function NotificationRecipientsManager() {
  const [recipients, setRecipients] = useState<InternalNotificationRecipient[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [adding,     setAdding]     = useState(false);
  const [busyId,     setBusyId]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/notification-recipients');
      const data = await res.json();
      if (res.ok) setRecipients(data.recipients ?? []);
      else toast.error(data.error ?? 'Failed to load recipients');
    } catch {
      toast.error('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function remove(recipient: InternalNotificationRecipient) {
    setBusyId(recipient.id);
    try {
      const res = await fetch(`/api/notification-recipients/${recipient.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to remove recipient');
        return;
      }
      setRecipients((prev) => prev.filter((r) => r.id !== recipient.id));
      toast.success(`${recipient.email} removed`);
    } catch {
      toast.error('Network error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        {!loading && (
          <p className="text-sm text-brand-muted">
            <strong className="text-brand-ink">{recipients.length}</strong>
            {' '}{recipients.length === 1 ? 'recipient' : 'recipients'}
          </p>
        )}
        <button
          onClick={() => setAdding(true)}
          className={cn(
            'ml-auto inline-flex items-center justify-center gap-1.5 min-h-11 px-4 rounded-xl',
            'text-sm font-medium bg-brand-primary text-white hover:bg-brand-primary/90 transition-colors',
          )}
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          Add recipient
        </button>
      </div>

      {loading ? (
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-brand-sunken" />
          ))}
        </div>
      ) : recipients.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-brand-border bg-white px-4 py-12 text-center">
          <Bell className="w-6 h-6 text-brand-muted" aria-hidden="true" />
          <p className="text-sm font-medium text-brand-ink mt-3">No recipients yet.</p>
          <p className="text-xs text-brand-muted mt-1">
            Nobody gets the internal dispatch alert until you add an address.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-brand-border overflow-hidden rounded-2xl border border-brand-border bg-white shadow-[0_2px_8px_rgba(12,42,32,0.04)]">
          {recipients.map((recipient) => (
            <li
              key={recipient.id}
              className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-5"
            >
              <div className="min-w-0 flex-1">
                {recipient.label && (
                  <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                    {recipient.label}
                  </span>
                )}
                <p className="text-[15px] font-semibold text-brand-ink mt-1.5 break-words">
                  {recipient.email}
                </p>
                <p className="text-xs text-brand-muted mt-1">
                  Added <span className="font-mono">{formatAdminDate(recipient.created_at)}</span>
                </p>
              </div>

              <button
                onClick={() => remove(recipient)}
                disabled={busyId === recipient.id}
                aria-label={`Remove ${recipient.email}`}
                className={cn(
                  'inline-flex items-center justify-center gap-1.5 min-h-11 px-3 rounded-lg shrink-0',
                  'text-xs font-medium border transition-colors disabled:opacity-40 whitespace-nowrap',
                  'border-red-200 bg-red-50 text-red-700 hover:bg-red-100',
                )}
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
                {busyId === recipient.id ? 'Removing…' : 'Remove'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <AddRecipientModal
          onClose={() => setAdding(false)}
          onAdded={() => { setAdding(false); load(); }}
        />
      )}
    </div>
  );
}
