'use client';
// src/components/admin/MeterCalculatorAccessManager.tsx
// Control Center panel: grant/revoke the Meter Calculator (Job Separation)
// to specific individual logins. Sits beside DepartmentsManager on
// /admin/departments — per-person, not per-department, so it's a separate
// checklist over /api/team rather than a row in DepartmentsManager's
// per-department FEATURES grid.

import { useCallback, useEffect, useState } from 'react';
import { Calculator } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';

type Member = { id: string; email: string; department: string | null };
type Grant = { user_id: string; email: string; created_at: string };

export default function MeterCalculatorAccessManager() {
  const [members, setMembers] = useState<Member[]>([]);
  const [grantedIds, setGrantedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [teamRes, grantsRes] = await Promise.all([
        fetch('/api/team'),
        fetch('/api/meter-calculator-access'),
      ]);
      const teamData = await teamRes.json();
      const grantsData = await grantsRes.json();
      if (teamRes.ok) setMembers(teamData.members ?? []);
      else toast.error(teamData.error ?? 'Failed to load team');
      if (grantsRes.ok) setGrantedIds(new Set((grantsData.grants as Grant[] ?? []).map((g) => g.user_id)));
      else toast.error(grantsData.error ?? 'Failed to load Meter Calculator access');
    } catch {
      toast.error('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggle(member: Member, grant: boolean) {
    setBusyId(member.id);
    try {
      const res = grant
        ? await fetch('/api/meter-calculator-access', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: member.id }),
          })
        : await fetch(`/api/meter-calculator-access/${member.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to update access');
        return;
      }
      setGrantedIds((prev) => {
        const next = new Set(prev);
        if (grant) next.add(member.id); else next.delete(member.id);
        return next;
      });
    } catch {
      toast.error('Network error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="glass rounded-2xl border border-[var(--glass-border)] p-5">
      <div className="flex items-center gap-2 mb-1">
        <Calculator className="w-4 h-4 text-[var(--glass-muted)]" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-[var(--glass-ink)]">Meter Calculator access</h2>
      </div>
      <p className="text-sm text-[var(--glass-muted)] mb-4">
        Grant the Job Separation Meter Calculator to specific people, regardless of department.
      </p>

      {loading ? (
        <p className="text-sm text-[var(--glass-muted)]">Loading…</p>
      ) : members.length === 0 ? (
        <p className="text-sm text-[var(--glass-muted)]">No team logins yet.</p>
      ) : (
        <ul className="divide-y divide-[var(--glass-border)]">
          {members.map((m) => {
            const granted = grantedIds.has(m.id);
            return (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm text-[var(--glass-ink)] truncate">{m.email}</p>
                  {m.department && (
                    <p className="text-xs text-[var(--glass-muted)]">{m.department}</p>
                  )}
                </div>
                <label className="inline-flex items-center gap-2 shrink-0 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={granted}
                    disabled={busyId === m.id}
                    onChange={(e) => toggle(m, e.target.checked)}
                    className={cn('w-4 h-4 rounded accent-brand-primary', busyId === m.id && 'opacity-50')}
                  />
                  <span className="text-xs text-[var(--glass-muted)]">
                    {granted ? 'Granted' : 'Off'}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
