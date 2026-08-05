'use client';
// src/components/admin/RemoveAdminModal.tsx
// Removing a fellow Admin needs more than a second click — an Admin account
// has full access, so this asks the ACTING admin to re-enter their own
// password before the account comes off. Removing any other department
// stays a plain two-step Confirm button in TeamManager; this modal only
// ever appears for an Admin target.

import React, { useState, useId } from 'react';
import { Check, X, ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { ModalShell } from './modals';
import type { Member } from '@/lib/types';

const inputCls = cn(
  'w-full px-3 py-2 rounded-lg text-sm bg-[var(--glass-bg)] border border-[var(--glass-border)]',
  'text-[var(--glass-ink)] placeholder:text-[var(--glass-muted)]',
  'focus:outline-none focus:border-emerald-300/70 focus:bg-white/[0.14]',
  'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
);

type Props = {
  member: Member;
  onClose: () => void;
  onRemoved: () => void;
};

export default function RemoveAdminModal({ member, onClose, onRemoved }: Props) {
  const titleId = useId();

  const [password, setPassword] = useState('');
  const [removing, setRemoving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!password) {
      toast.error('Enter your password to confirm');
      return;
    }

    setRemoving(true);
    try {
      const res = await fetch(`/api/team/${member.id}`, {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to remove member');
        return;
      }
      toast.success(`${member.email} removed`);
      onRemoved();
    } catch {
      toast.error('Network error');
    } finally {
      setRemoving(false);
    }
  }

  return (
    <ModalShell titleId={titleId} onClose={removing ? undefined : onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col">
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-white/12 shrink-0">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-[var(--glass-ink)] flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-red-500" aria-hidden="true" />
              Remove an Admin
            </h2>
            <p className="text-xs text-[var(--glass-muted)] mt-0.5">
              Enter your own password to confirm removing {member.email}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close without removing"
            className="p-1.5 -m-1.5 rounded-lg text-[var(--glass-muted)] hover:text-[var(--glass-ink)] hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="px-5 py-4">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--glass-muted)] mb-1.5">
            Your password
          </span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Confirm it's you"
            autoComplete="current-password"
            autoFocus
            className={inputCls}
          />
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-white/12 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={removing}
            className="px-4 py-2 text-sm font-medium text-[var(--glass-muted)] hover:text-[var(--glass-ink)] disabled:opacity-40 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={removing}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium',
              'bg-red-600 text-white hover:bg-red-700',
              'disabled:opacity-40 transition-colors',
            )}
          >
            <Check className="w-4 h-4" aria-hidden="true" />
            {removing ? 'Removing…' : 'Remove admin'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
