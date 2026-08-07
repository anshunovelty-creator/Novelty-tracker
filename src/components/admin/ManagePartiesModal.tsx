'use client';
// src/components/admin/ManagePartiesModal.tsx
// The master list of party names Job Separation's Party field picks
// from. Prepress/Admin only — add a party the picker doesn't have yet,
// or remove one that was mistyped.
//
// Removing a party here never touches a job separation row already
// saved with that name — the row stores the name as free text, not a
// reference to this table (see AddJobSeparationModal's Party picker).

import React, { useState, useEffect, useCallback, useId } from 'react';
import { Trash2, Plus, Users, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { ModalShell } from './modals';
import type { Party } from '@/lib/types';

const inputCls = cn(
  'w-full min-h-11 px-3 py-2 rounded-lg text-sm bg-[var(--glass-bg)] border border-[var(--glass-border)]',
  'text-[var(--glass-ink)] placeholder:text-[var(--glass-muted)]',
  'focus:outline-none focus:border-emerald-300/70 focus:bg-white/[0.14]',
  'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
);

export default function ManagePartiesModal({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  const [parties,    setParties]    = useState<Party[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [newName,    setNewName]    = useState('');
  const [adding,     setAdding]     = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busyId,     setBusyId]     = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res  = await fetch('/api/parties');
      const data = await res.json();
      if (res.ok) setParties(data.parties ?? []);
      else toast.error(data.error ?? 'Failed to load parties');
    } catch {
      toast.error('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addParty(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;

    setAdding(true);
    try {
      const res  = await fetch('/api/parties', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to add party');
        return;
      }
      setParties((prev) =>
        prev.some((p) => p.id === data.party.id)
          ? prev
          : [...prev, data.party].sort((a, b) =>
              a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
            )
      );
      setNewName('');
      toast.success('Party added');
    } catch {
      toast.error('Network error');
    } finally {
      setAdding(false);
    }
  }

  async function remove(party: Party) {
    setBusyId(party.id);
    try {
      const res  = await fetch(`/api/parties/${party.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to remove party');
        return;
      }
      setParties((prev) => prev.filter((p) => p.id !== party.id));
      toast.success('Party removed');
    } catch {
      toast.error('Network error');
    } finally {
      setBusyId(null);
      setConfirming(null);
    }
  }

  return (
    <ModalShell titleId={titleId} onClose={onClose}>
      <div className="flex flex-col max-h-[85vh]">
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-white/12 shrink-0">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-[var(--glass-ink)] flex items-center gap-2">
              <Users className="w-4 h-4" aria-hidden="true" />
              Parties
            </h2>
            <p className="text-xs text-[var(--glass-muted)] mt-0.5">
              The master list Job Separation&apos;s Party field picks from
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 -m-1.5 rounded-lg text-[var(--glass-muted)] hover:text-[var(--glass-ink)] hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={addParty} className="flex items-center gap-2 px-5 py-3 border-b border-white/12 shrink-0">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Add a party name…"
            className={inputCls}
          />
          <button
            type="submit"
            disabled={adding || !newName.trim()}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 min-h-11 px-3 rounded-lg shrink-0',
              'text-sm font-medium bg-brand-primary text-white hover:bg-brand-primary/90',
              'disabled:opacity-40 transition-colors',
            )}
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            Add
          </button>
        </form>

        <div className="px-5 py-3 overflow-y-auto">
          {loading ? (
            <div className="space-y-2" aria-hidden="true">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-10 rounded-lg bg-black/[0.04]" />
              ))}
            </div>
          ) : parties.length === 0 ? (
            <p className="text-sm text-[var(--glass-muted)] text-center py-6">
              No parties yet. Add the first one above.
            </p>
          ) : (
            <ul className="divide-y divide-white/10">
              {parties.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm text-[var(--glass-ink)] truncate">{p.name}</span>
                  <button
                    type="button"
                    onClick={() => (confirming === p.id ? remove(p) : setConfirming(p.id))}
                    onBlur={() => setConfirming((id) => (id === p.id ? null : id))}
                    disabled={busyId === p.id}
                    className={cn(
                      'inline-flex items-center gap-1.5 shrink-0 min-h-11 px-2.5 rounded-lg',
                      'text-xs font-medium border transition-colors disabled:opacity-50 whitespace-nowrap',
                      confirming === p.id
                        ? 'border-red-300 bg-red-100 text-red-800 hover:bg-red-200'
                        : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100',
                    )}
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    {busyId === p.id ? 'Removing…' : confirming === p.id ? 'Confirm' : 'Remove'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </ModalShell>
  );
}
