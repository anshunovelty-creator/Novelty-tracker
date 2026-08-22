'use client';
// src/components/admin/PartyContactsManager.tsx
// Party → email/WhatsApp mapping that /api/notifications/email and
// /api/dispatch-notifications/send look up automatically by party name.
// Add/edit is Admin-only (matches party_contacts' RLS); Dispatch can view
// so they can see who will actually get emailed before sending a batch.

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Contact as ContactIcon, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, formatAdminDate } from '@/lib/utils';
import type { PartyContact } from '@/lib/types';
import AddPartyContactModal from './AddPartyContactModal';

export default function PartyContactsManager({ canEdit }: { canEdit: boolean }) {
  const [contacts, setContacts] = useState<PartyContact[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [editing,  setEditing]  = useState<PartyContact | 'new' | null>(null);
  const [busyId,   setBusyId]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/party-contacts');
      const data = await res.json();
      if (res.ok) setContacts(data.contacts ?? []);
      else toast.error(data.error ?? 'Failed to load party contacts');
    } catch {
      toast.error('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function remove(contact: PartyContact) {
    setBusyId(contact.id);
    try {
      const res = await fetch(`/api/party-contacts/${contact.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to remove contact');
        return;
      }
      setContacts((prev) => prev.filter((c) => c.id !== contact.id));
      toast.success(`${contact.party} removed`);
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
          <p className="text-sm text-[var(--glass-muted)]">
            <strong className="text-[var(--glass-ink)]">{contacts.length}</strong>
            {' '}{contacts.length === 1 ? 'contact' : 'contacts'} on file
          </p>
        )}
        {canEdit && (
          <button
            onClick={() => setEditing('new')}
            className={cn(
              'ml-auto inline-flex items-center justify-center gap-1.5 min-h-11 px-4 rounded-xl',
              'text-sm font-medium bg-brand-primary text-white hover:bg-brand-primary/90 transition-colors',
            )}
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            Add contact
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-black/[0.04]" />
          ))}
        </div>
      ) : contacts.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center rounded-xl border border-black/[0.08] bg-white px-4 py-12">
          <ContactIcon className="w-6 h-6 text-[var(--glass-muted)]" aria-hidden="true" />
          <p className="text-sm font-medium text-[var(--glass-ink)] mt-3">No party contacts yet.</p>
          <p className="text-xs text-[var(--glass-muted)] mt-1">
            No party will get a dispatch email until it has one here.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {contacts.map((contact) => (
            <li
              key={contact.id}
              className="rounded-xl border border-black/[0.08] bg-white p-4 flex flex-col sm:flex-row sm:items-center gap-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[var(--glass-ink)]">{contact.party}</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 mt-1 text-xs text-[var(--glass-muted)]">
                  {contact.contact_name && <span>{contact.contact_name}</span>}
                  <span className={contact.email ? undefined : 'text-amber-600'}>
                    {contact.email ?? 'No email on file'}
                  </span>
                  {contact.whatsapp && <span>WhatsApp: {contact.whatsapp}</span>}
                </div>
                <p className="text-xs text-[var(--glass-muted)] mt-1">
                  Added <span className="font-mono">{formatAdminDate(contact.created_at)}</span>
                </p>
              </div>

              {canEdit && (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setEditing(contact)}
                    aria-label={`Edit ${contact.party}`}
                    className={cn(
                      'inline-flex items-center justify-center gap-1.5 min-h-11 px-3 rounded-lg',
                      'text-xs font-medium border transition-colors whitespace-nowrap',
                      'border-black/[0.12] bg-white text-[var(--glass-ink)] hover:bg-black/[0.04]',
                    )}
                  >
                    <Pencil className="w-4 h-4" aria-hidden="true" />
                    Edit
                  </button>
                  <button
                    onClick={() => remove(contact)}
                    disabled={busyId === contact.id}
                    aria-label={`Remove ${contact.party}`}
                    className={cn(
                      'inline-flex items-center justify-center gap-1.5 min-h-11 px-3 rounded-lg',
                      'text-xs font-medium border transition-colors disabled:opacity-40 whitespace-nowrap',
                      'border-red-200 bg-red-50 text-red-700 hover:bg-red-100',
                    )}
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                    {busyId === contact.id ? 'Removing…' : 'Remove'}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <AddPartyContactModal
          existing={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}
