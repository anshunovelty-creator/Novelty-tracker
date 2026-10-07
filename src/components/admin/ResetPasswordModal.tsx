'use client';
// src/components/admin/ResetPasswordModal.tsx
// Team › Reset password. Admin sets a new password and hands it over in
// person or on chat, the same way Add member works — so the field is plain
// text with Generate and Copy. An Admin login (or your own) also asks for
// your current password; the server enforces that either way.

import React, { useId, useState } from 'react';
import { Copy, Dices } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { ModalShell } from './modals';
import type { Member } from '@/lib/types';

const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';

export function generatePassword(length = 12): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => PASSWORD_CHARS[b % PASSWORD_CHARS.length]).join('');
}

const fieldCls = cn(
  'h-11 w-full rounded-[10px] border border-brand-border bg-white px-3 text-[15px] text-brand-ink',
  'focus:border-brand-primary focus:outline-none focus:shadow-[0_0_0_4px_rgba(16,85,63,0.18)]',
);

export default function ResetPasswordModal({
  member, label, needsOwnPassword, onClose,
}: {
  member: Member;
  /** How the member is named in the list. */
  label: string;
  needsOwnPassword: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  const newId   = useId();
  const ownId   = useId();
  const [next, setNext]       = useState(() => generatePassword());
  const [own, setOwn]         = useState('');
  const [saving, setSaving]   = useState(false);

  async function copy() {
    try { await navigator.clipboard.writeText(next); toast.success('Password copied'); }
    catch { toast.error('Could not copy — select and copy it by hand'); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    if (needsOwnPassword && !own) { toast.error('Enter your password to confirm'); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/team/${member.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_password: next, ...(needsOwnPassword ? { password: own } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Could not reset the password'); return; }
      toast.success(`New password set for ${label}. Share it now — it isn’t shown again.`);
      onClose();
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell titleId={titleId} onClose={saving ? undefined : onClose}>
      <form onSubmit={submit} className="flex flex-col text-brand-ink">
        <div className="flex flex-col gap-1 border-b border-brand-line-soft bg-white px-6 py-5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-brand-muted">Team · Admin</span>
          <h2 id={titleId} className="text-lg font-semibold">Reset password for {label}</h2>
          <p className="font-mono text-xs text-brand-muted">{member.email}</p>
        </div>

        <div className="flex flex-col gap-4 bg-white px-6 py-5">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor={newId} className="text-xs font-medium text-brand-muted">New password</label>
              <div className="flex gap-1">
                <button type="button" onClick={() => setNext(generatePassword())} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-medium text-brand-muted hover:bg-brand-surface-alt hover:text-brand-ink">
                  <Dices className="h-3.5 w-3.5" aria-hidden="true" /> Generate
                </button>
                <button type="button" onClick={copy} disabled={!next} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-medium text-brand-muted hover:bg-brand-surface-alt hover:text-brand-ink disabled:opacity-40">
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy
                </button>
              </div>
            </div>
            <input id={newId} type="text" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="off" spellCheck={false} className={cn(fieldCls, 'font-mono')} />
            <p className="text-xs text-brand-muted">At least 8 characters. Share it with them now — it isn’t shown again.</p>
          </div>

          {needsOwnPassword && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={ownId} className="text-xs font-medium text-brand-muted">Your password</label>
              <input id={ownId} type="password" value={own} onChange={(e) => setOwn(e.target.value)} autoComplete="current-password" className={fieldCls} />
              <p className="text-xs text-brand-muted">Needed for an Admin login, or your own.</p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-brand-line-soft px-6 py-3.5">
          <button type="button" onClick={onClose} disabled={saving} className="min-h-11 rounded-[10px] px-4 text-sm font-medium text-brand-muted hover:bg-brand-surface-hover hover:text-brand-ink">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="min-h-11 rounded-[10px] bg-brand-primary px-4 text-sm font-semibold text-white hover:bg-brand-primary-hover disabled:opacity-50">
            {saving ? 'Saving…' : 'Set new password'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
