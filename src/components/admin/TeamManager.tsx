'use client';
// src/components/admin/TeamManager.tsx
// Every login this app has: who it is, which department, when it last signed
// in, and Reset password. Admin-only page — the route itself redirects
// anyone else away, so there's no canManage prop to thread through here.
//
// Deleting your own row, or the last Admin's, is blocked server-side; the
// button is disabled here too so the reason is visible before someone tries.

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, Trash2, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, formatAdminDate } from '@/lib/utils';
import { initials, signedInWords } from '@/lib/team';
import { normalizeUsername, usernameProblem, USERNAME_MAX } from '@/lib/username';
import ResetPasswordModal from './ResetPasswordModal';
import type { Member } from '@/lib/types';
import AddMemberModal from './AddMemberModal';
import RemoveAdminModal from './RemoveAdminModal';
import { useDepartments } from '@/hooks/useReferenceData';

type DepartmentOption = { key: string; display_name: string; is_super_admin: boolean };

export default function TeamManager({ currentUserId }: { currentUserId: string }) {
  const router = useRouter();
  const [members,       setMembers]       = useState<Member[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [adding,        setAdding]        = useState(false);
  const [confirming,    setConfirming]    = useState<string | null>(null);
  const [busyId,        setBusyId]        = useState<string | null>(null);
  // Removing an Admin never uses the inline two-step button — it always
  // goes through RemoveAdminModal's password check instead.
  const [removingAdmin, setRemovingAdmin] = useState<Member | null>(null);
  const [resetting,     setResetting]     = useState<Member | null>(null);
  const [renamingId,    setRenamingId]    = useState<string | null>(null);
  const [nameDraft,     setNameDraft]     = useState('');

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

  const { data: departments = [], isError: departmentsFailed } = useDepartments<DepartmentOption>();
  useEffect(() => {
    if (departmentsFailed) toast.error('Failed to load the departments list');
  }, [departmentsFailed]);

  const deptNames = Object.fromEntries(departments.map((d) => [d.key, d.display_name]));
  const superAdminKeys = new Set(departments.filter((d) => d.is_super_admin).map((d) => d.key));
  const adminCount = members.filter((m) => m.department && superAdminKeys.has(m.department)).length;

  // Every login goes by its @username — shown top-right for that person and
  // typed to tag them in notes and messages. Older logins show one derived
  // from their old name or email until Admin sets a real one.
  const labelOf = (m: Member) => m.username;

  async function rename(member: Member) {
    const username = normalizeUsername(nameDraft);
    setRenamingId(null);
    if (!username || username === member.username) return;
    const bad = usernameProblem(username);
    if (bad) { toast.error(bad); return; }
    setMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, username } : m)));
    try {
      const res = await fetch(`/api/team/${member.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not change the username');
      toast.success(`Username set to @${username}`);
      if (member.id === currentUserId) router.refresh();
    } catch (e) {
      setMembers((prev) => prev.map((m) => (m.id === member.id ? member : m)));
      toast.error(e instanceof Error ? e.message : 'Could not change the username');
    }
  }

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

  const now = new Date();

  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Logins" className="overflow-hidden rounded-2xl border border-brand-border bg-white shadow-[0_2px_8px_rgba(12,42,32,0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <p className="text-[13px] text-brand-muted">
            {loading ? 'Loading…' : <><span className="font-mono font-semibold text-brand-ink">{members.length}</span> {members.length === 1 ? 'login' : 'logins'}</>}
          </p>
          <button
            onClick={() => setAdding(true)}
            className="inline-flex min-h-11 items-center gap-2 rounded-[10px] bg-brand-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-primary-hover"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add member
          </button>
        </div>

        {loading ? (
          <div aria-hidden="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 border-t border-brand-line-soft px-5 py-3.5">
                <div className="h-10 w-10 rounded-full bg-brand-sunken" />
                <div className="h-4 w-48 rounded bg-brand-sunken" />
              </div>
            ))}
          </div>
        ) : members.length === 0 ? (
          <div className="flex flex-col items-center justify-center border-t border-brand-line-soft px-4 py-12 text-center">
            <Users className="h-6 w-6 text-brand-muted" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium text-brand-ink">No logins yet.</p>
          </div>
        ) : (
          <ul>
            {members.map((member) => {
              const isSelf      = member.id === currentUserId;
              const isAdmin     = member.department != null && superAdminKeys.has(member.department);
              const isLastAdmin = isAdmin && adminCount <= 1;
              const blocked     = isSelf || isLastAdmin;
              const label       = labelOf(member);
              const seen        = signedInWords(member.last_sign_in_at, now);

              return (
                <li key={member.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-brand-line-soft px-5 py-3.5">
                  <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#E2EFE8] text-sm font-semibold text-brand-primary">
                    {initials(label)}
                  </span>

                  <div className="min-w-0 flex-[1_1_220px]">
                    {renamingId === member.id ? (
                      <input
                        autoFocus
                        aria-label={`Username for ${member.email}`}
                        value={nameDraft}
                        maxLength={USERNAME_MAX + 1}
                        autoCapitalize="none"
                        spellCheck={false}
                        onChange={(e) => setNameDraft(e.target.value.toLowerCase().replace(/\s/g, ''))}
                        onBlur={() => rename(member)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); rename(member); }
                          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setRenamingId(null); }
                        }}
                        placeholder={label}
                        className="h-9 w-full max-w-[280px] rounded-lg border border-brand-primary px-2 text-[15px] font-semibold text-brand-ink focus:outline-none focus:shadow-[0_0_0_4px_rgba(16,85,63,0.18)]"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setRenamingId(member.id); setNameDraft(member.username); }}
                        className="group flex min-h-9 items-center gap-1.5 text-left text-[15px] font-semibold text-brand-ink"
                        aria-label={`Change username @${label}`}
                        title="Change username"
                      >
                        <span className="truncate"><span className="text-brand-muted">@</span>{label}</span>
                        {isSelf && <span className="text-xs font-semibold text-brand-primary">You</span>}
                        <Pencil className="h-3.5 w-3.5 shrink-0 text-brand-faint opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true" />
                      </button>
                    )}
                    <p className="truncate font-mono text-xs text-brand-muted">{member.email}</p>
                  </div>

                  <span className="inline-flex min-w-[120px] justify-center rounded-lg border border-brand-border bg-[#F1F5F2] px-2.5 py-1 text-xs font-medium text-brand-ink">
                    {member.department ? (deptNames[member.department] ?? member.department) : 'No department'}
                  </span>

                  <span
                    className={cn('min-w-[150px] text-[13px]', seen.recent ? 'text-brand-success' : 'text-brand-muted')}
                    title={member.last_sign_in_at ? `Last sign-in ${formatAdminDate(member.last_sign_in_at)} · joined ${formatAdminDate(member.created_at)}` : `Joined ${formatAdminDate(member.created_at)}`}
                  >
                    {seen.text}
                  </span>

                  <div className="ml-auto flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setResetting(member)}
                      className="min-h-10 rounded-[10px] border border-brand-border bg-white px-3 text-[13px] font-medium text-brand-ink transition-colors hover:bg-brand-surface-alt"
                    >
                      Reset password
                    </button>
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
                      aria-label={confirming === member.id ? `Confirm removing ${label}` : `Remove ${label}`}
                      className={cn(
                        'inline-flex min-h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] px-2.5 text-[13px] font-medium transition-colors disabled:opacity-30',
                        confirming === member.id
                          ? 'bg-brand-danger text-white hover:bg-red-800'
                          : 'text-brand-danger hover:bg-[#FEF2F2]',
                      )}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      {busyId === member.id ? 'Removing…' : confirming === member.id ? 'Confirm' : null}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {resetting && (
        <ResetPasswordModal
          member={resetting}
          label={labelOf(resetting)}
          needsOwnPassword={resetting.id === currentUserId || (resetting.department != null && superAdminKeys.has(resetting.department))}
          onClose={() => setResetting(null)}
        />
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
