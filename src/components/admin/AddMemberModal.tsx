'use client';
// src/components/admin/AddMemberModal.tsx
// Onboarding a new login. Email and department are what every other
// department-gated check in this app reads back out of the account, so
// both are required — there's no such thing as a member with no department.
//
// The password field is plain text, not masked: whoever is creating the
// account has to read it back to hand to the new hire, typically over chat
// or in person. "Generate" exists so nobody has to invent one on the spot.

import React, { useState, useId, useEffect } from 'react';
import { Check, X, Dices, Copy } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { ModalShell } from './modals';

type DepartmentOption = { key: string; display_name: string };

const inputCls = cn(
  'w-full px-3 py-2 rounded-lg text-sm bg-[var(--glass-bg)] border border-[var(--glass-border)]',
  'text-[var(--glass-ink)] placeholder:text-[var(--glass-muted)]',
  'focus:outline-none focus:border-emerald-300/70 focus:bg-white/[0.14]',
  'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
);

const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';

function generatePassword(length = 12): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => PASSWORD_CHARS[b % PASSWORD_CHARS.length]).join('');
}

type Props = {
  onClose: () => void;
  onAdded: () => void;
};

export default function AddMemberModal({ onClose, onAdded }: Props) {
  const titleId = useId();

  const [email,       setEmail]       = useState('');
  const [department,  setDepartment]  = useState('');
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [password,    setPassword]    = useState('');
  const [saving,      setSaving]      = useState(false);

  useEffect(() => {
    fetch('/api/departments')
      .then((res) => res.json())
      .then((data) => setDepartments(data.departments ?? []))
      .catch(() => toast.error('Failed to load the departments list'));
  }, []);

  function fillGeneratedPassword() {
    setPassword(generatePassword());
  }

  async function copyPassword() {
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      toast.success('Password copied');
    } catch {
      toast.error('Could not copy — select and copy manually');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!email.trim())    { toast.error('Enter the new member’s email'); return; }
    if (!department)      { toast.error('Choose a department'); return; }
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/team', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), department, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to create the account');
        return;
      }
      toast.success('Member added — share the password with them now, it won’t be shown again');
      onAdded();
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
              Add team member
            </h2>
            <p className="text-xs text-[var(--glass-muted)] mt-0.5">
              Creates a login — copy the password before saving, it isn&rsquo;t shown again
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
            <MemberLabel required>Email</MemberLabel>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. name@noveltylabels.com"
              autoComplete="off"
              className={inputCls}
            />
          </div>

          <div>
            <MemberLabel required>Department</MemberLabel>
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className={cn(inputCls, 'appearance-none')}
            >
              <option value="" disabled>Choose one</option>
              {departments.map((d) => (
                <option key={d.key} value={d.key}>{d.display_name}</option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <MemberLabel required>Password</MemberLabel>
              <div className="flex items-center gap-2 -mt-1.5">
                <button
                  type="button"
                  onClick={fillGeneratedPassword}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--glass-muted)] hover:text-[var(--glass-ink)] transition-colors"
                >
                  <Dices className="w-3.5 h-3.5" aria-hidden="true" />
                  Generate
                </button>
                <button
                  type="button"
                  onClick={copyPassword}
                  disabled={!password}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--glass-muted)] hover:text-[var(--glass-ink)] disabled:opacity-40 transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  Copy
                </button>
              </div>
            </div>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
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
            {saving ? 'Adding…' : 'Add member'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function MemberLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--glass-muted)] mb-1.5">
      {children}
      {required && <span className="text-red-300 ml-0.5" aria-hidden="true">*</span>}
    </span>
  );
}
