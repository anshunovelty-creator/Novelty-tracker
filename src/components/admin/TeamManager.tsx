'use client';
// src/components/admin/TeamManager.tsx
// Every login this app has. Admin-only page — the route itself redirects
// anyone else away, so there's no canManage prop to thread through here.
//
// Deleting your own row, or the last Admin's, is blocked server-side; the
// button is disabled here too so the reason is visible before someone tries.

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, formatAdminDate } from '@/lib/utils';
import type { Member } from '@/lib/types';
import AddMemberModal from './AddMemberModal';
import RemoveAdminModal from './RemoveAdminModal';

type DepartmentOption = { key: string; display_name: string; is_super_admin: boolean };

export default function TeamManager({ currentUserId }: { currentUserId: string }) {
  const [members,       setMembers]       = useState<Member[]>([]);
  const [departments,   setDepartments]   = useState<DepartmentOption[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [adding,        setAdding]        = useState(false);
  const [confirming,    setConfirming]    = useState<string | null>(null);
  const [busyId,        setBusyId]        = useState<string | null>(null);
  // Removing an Admin never uses the inline two-step button — it always
  // goes through RemoveAdminModal's password check instead.
  const [removingAdmin, setRemovingAdmin] = useState<Member | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/team');
      const data = await res.json();
      if (res.ok) setMembers(data.members ?? []);
      else toast.error(data.error ?? 'Failed to load the team');
    } catch {
      toast.error('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch('/api/departments')
      .then((res) => res.json())
      .then((data) => setDepartments(data.departments ?? []))
      .catch(() => toast.error('Failed to load the departments list'));
  }, []);

  const deptNames = Object.fromEntries(departments.map((d) => [d.key, d.display_name]));
  const superAdminKeys = new Set(departments.filter((d) => d.is_super_admin).map((d) => d.key));
  const adminCount = members.filter((m) => m.department && superAdminKeys.has(m.department)).length;

  async function remove(member: Member) {
    setBusyId(member.id);
    try {
      const res = await fetch(`/api/team/${member.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to remove member');
        return;
      }
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
      toast.success(`${member.email} removed`);
    } catch {
      toast.error('Network error');
    } finally {
      setBusyId(null);
      setConfirming(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        {!loading && (
          <p className="text-sm text-[var(--glass-muted)]">
            <strong className="text-[var(--glass-ink)]">{members.length}</strong>
            {' '}{members.length === 1 ? 'member' : 'members'}
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
          Add member
        </button>
      </div>

      {loading ? (
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-black/[0.04]" />
          ))}
        </div>
      ) : members.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center rounded-xl border border-black/[0.08] bg-white px-4 py-12">
          <Users className="w-6 h-6 text-[var(--glass-muted)]" aria-hidden="true" />
          <p className="text-sm font-medium text-[var(--glass-ink)] mt-3">No members yet.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {members.map((member) => {
            const isSelf      = member.id === currentUserId;
            const isAdmin     = member.department != null && superAdminKeys.has(member.department);
            const isLastAdmin = isAdmin && adminCount <= 1;
            const blocked     = isSelf || isLastAdmin;

            return (
              <li
                key={member.id}
                className="rounded-xl border border-black/[0.08] bg-white p-4 flex flex-col sm:flex-row sm:items-center gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                      {member.department ? (deptNames[member.department] ?? member.department) : 'No department'}
                    </span>
                    {isSelf && (
                      <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                        You
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-[var(--glass-ink)] mt-1.5 break-words">
                    {member.email}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs text-[var(--glass-muted)]">
                    <span>Joined <span className="font-mono">{formatAdminDate(member.created_at)}</span></span>
                    <span>
                      Last login{' '}
                      <span className="font-mono">
                        {member.last_sign_in_at ? formatAdminDate(member.last_sign_in_at) : 'never'}
                      </span>
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => {
                    if (isAdmin) { setRemovingAdmin(member); return; }
                    confirming === member.id ? remove(member) : setConfirming(member.id);
                  }}
                  onBlur={() => setConfirming((id) => (id === member.id ? null : id))}
                  disabled={blocked || busyId === member.id}
                  title={
                    isSelf      ? "You can't remove your own account" :
                    isLastAdmin ? 'At least one Admin account must remain' :
                    isAdmin     ? 'Removing an Admin asks for your password' :
                    undefined
                  }
                  aria-label={
                    confirming === member.id
                      ? `Confirm removing ${member.email}`
                      : `Remove ${member.email}`
                  }
                  className={cn(
                    'inline-flex items-center justify-center gap-1.5 min-h-11 px-3 rounded-lg shrink-0',
                    'text-xs font-medium border transition-colors disabled:opacity-40 whitespace-nowrap',
                    confirming === member.id
                      ? 'border-red-300 bg-red-100 text-red-800 hover:bg-red-200'
                      : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100',
                  )}
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                  {busyId === member.id
                    ? 'Removing…'
                    : confirming === member.id ? 'Confirm' : 'Remove'}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {adding && (
        <AddMemberModal
          onClose={() => setAdding(false)}
          onAdded={() => { setAdding(false); load(); }}
        />
      )}

      {removingAdmin && (
        <RemoveAdminModal
          member={removingAdmin}
          onClose={() => setRemovingAdmin(null)}
          onRemoved={() => { setRemovingAdmin(null); load(); }}
        />
      )}
    </div>
  );
}
