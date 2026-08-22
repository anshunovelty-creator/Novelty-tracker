'use client';
// src/components/admin/AddPartyContactModal.tsx
// Add or edit one contact for a party. A party can have several contacts
// (migration 046) — every one of them gets the dispatch/status emails.
// The party field is a dropdown sourced from the master Parties list
// (/api/parties, the same list Job Separation's Party picker uses) rather
// than free text — party must match jobs.party exactly (case-sensitive),
// so picking from the master list avoids a typo silently breaking the
// email lookup.

import React, { useState, useEffect, useId } from 'react';
import { Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { ModalShell } from './modals';
import type { Party, PartyContact } from '@/lib/types';

const inputCls = cn(
  'w-full px-3 py-2 rounded-lg text-sm bg-[var(--glass-bg)] border border-[var(--glass-border)]',
  'text-[var(--glass-ink)] placeholder:text-[var(--glass-muted)]',
  'focus:outline-none focus:border-emerald-300/70 focus:bg-white/[0.14]',
  'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
);

type Props = {
  existing: PartyContact | null;
  onClose:  () => void;
  onSaved:  () => void;
};

export default function AddPartyContactModal({ existing, onClose, onSaved }: Props) {
  const titleId = useId();

  const [parties,     setParties]     = useState<Party[]>([]);
  const [party,        setParty]        = useState(existing?.party ?? '');
  const [contactName,  setContactName]  = useState(existing?.contact_name ?? '');
  const [email,        setEmail]        = useState(existing?.email ?? '');
  const [whatsapp,      setWhatsapp]     = useState(existing?.whatsapp ?? '');
  const [saving,        setSaving]       = useState(false);

  useEffect(() => {
    fetch('/api/parties')
      .then((res) => res.json())
      .then((data) => setParties(data.parties ?? []))
      .catch(() => toast.error('Failed to load the parties list'));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!party.trim()) { toast.error('Choose a party'); return; }

    setSaving(true);
    try {
      const res = await fetch(
        existing ? `/api/party-contacts/${existing.id}` : '/api/party-contacts',
        {
          method:  existing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            party:        party.trim(),
            contact_name: contactName.trim() || undefined,
            email:        email.trim() || undefined,
            whatsapp:     whatsapp.trim() || undefined,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to save contact');
        return;
      }
      toast.success(existing ? 'Contact updated' : 'Contact added');
      onSaved();
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell titleId={titleId} onClose={saving ? undefined : onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col max-h-[85vh]">
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-white/12 shrink-0">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-[var(--glass-ink)]">
              {existing ? 'Edit contact' : 'Add party contact'}
            </h2>
            <p className="text-xs text-[var(--glass-muted)] mt-0.5">
              Every contact on file for a party gets cc&rsquo;d on its dispatch/status emails
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close without saving"
            className="p-1.5 -m-1.5 rounded-lg text-[var(--glass-muted)] hover:text-[var(--glass-ink)] hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-4">
          <div>
            <ContactLabel required>Party</ContactLabel>
            <select
              value={party}
              onChange={(e) => setParty(e.target.value)}
              className={cn(inputCls, 'appearance-none')}
            >
              <option value="" disabled>Choose a party</option>
              {parties.map((p) => (
                <option key={p.id} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <ContactLabel>Contact name</ContactLabel>
            <input
              type="text"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="e.g. Rajesh Singh"
              autoComplete="off"
              className={inputCls}
            />
          </div>

          <div>
            <ContactLabel>Email</ContactLabel>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. orders@party.com"
              autoComplete="off"
              className={inputCls}
            />
          </div>

          <div>
            <ContactLabel>WhatsApp</ContactLabel>
            <input
              type="text"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="Country code + number, e.g. 919876543210"
              autoComplete="off"
              className={cn(inputCls, 'font-mono')}
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-white/12 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-[var(--glass-muted)] hover:text-[var(--glass-ink)] disabled:opacity-40 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium',
              'bg-brand-primary text-white hover:bg-brand-primary/90',
              'disabled:opacity-40 transition-colors',
            )}
          >
            <Check className="w-4 h-4" aria-hidden="true" />
            {saving ? 'Saving…' : existing ? 'Save changes' : 'Add contact'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ContactLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--glass-muted)] mb-1.5">
      {children}
      {required && <span className="text-red-300 ml-0.5" aria-hidden="true">*</span>}
    </span>
  );
}
