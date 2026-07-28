'use client';

// src/components/admin/PrintingUnitsManager.tsx
// ============================================================
// Admin CRUD for printing units.
//
// The lowest sort_order among ACTIVE units of a method is that method's
// default — the one auto-assigned to a job when its printing_method is
// set. That is surfaced explicitly with a "Default" badge, because the
// rule is otherwise invisible and admins would have no way to tell which
// unit a new job lands on.
// ============================================================

import { useEffect, useState, useCallback } from 'react';
import { Loader2, Plus, Trash2, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PRINTING_METHODS, type PrintingMethod, type PrintingUnit } from '@/lib/types';

const inputCls =
  'rounded-lg border border-black/[0.12] bg-white px-3 py-2 text-sm ' +
  'text-[var(--glass-ink)] min-h-[44px] w-full ' +
  'focus:outline-none focus:ring-2 focus:ring-[var(--brand-accent)] focus:border-transparent ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

const btnCls =
  'inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-lg ' +
  'text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export default function PrintingUnitsManager() {
  const [units,   setUnits]   = useState<PrintingUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [busyId,  setBusyId]  = useState<string | null>(null);

  // New-unit form
  const [newName,   setNewName]   = useState('');
  const [newMethod, setNewMethod] = useState<PrintingMethod>('Flexo');
  const [creating,  setCreating]  = useState(false);

  // Inline edit
  const [editId,     setEditId]     = useState<string | null>(null);
  const [editName,   setEditName]   = useState('');
  const [editMethod, setEditMethod] = useState<PrintingMethod>('Flexo');

  const load = useCallback(async () => {
    setError(null);
    try {
      // all=true so retired units stay visible and can be reactivated.
      const res  = await fetch('/api/printing-units?all=true');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load units');
      setUnits(json.units ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load units');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /** Default unit per method = lowest sort_order among active units. */
  const defaultIdFor = (method: PrintingMethod) =>
    units
      .filter((u) => u.is_active && u.printing_method === method)
      .sort((a, b) => a.sort_order - b.sort_order)[0]?.id;

  const defaultIds = new Set(
    PRINTING_METHODS.map(defaultIdFor).filter(Boolean) as string[],
  );

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;

    setCreating(true);
    setError(null);
    try {
      // Append to the end of its method group so adding a unit never
      // silently steals "default" from the one already in use.
      const maxSort = units.reduce((m, u) => Math.max(m, u.sort_order), 0);
      const res  = await fetch('/api/printing-units', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name,
          printing_method: newMethod,
          sort_order: maxSort + 1,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not create unit');
      setNewName('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create unit');
    } finally {
      setCreating(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    setError(null);
    try {
      const res  = await fetch(`/api/printing-units/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Update failed');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(unit: PrintingUnit) {
    // Deleting unassigns every job on this unit (FK is ON DELETE SET NULL),
    // so make that consequence explicit before it happens.
    const ok = window.confirm(
      `Delete "${unit.name}"?\n\n` +
      `Any job currently assigned to this unit will be left with no unit ` +
      `and must be reassigned. Retiring it instead keeps the history intact.`,
    );
    if (!ok) return;

    setBusyId(unit.id);
    setError(null);
    try {
      const res  = await fetch(`/api/printing-units/${unit.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Delete failed');
      if (json.jobs_unassigned > 0) {
        setError(`"${unit.name}" deleted — ${json.jobs_unassigned} job(s) now have no unit.`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusyId(null);
    }
  }

  function startEdit(u: PrintingUnit) {
    setEditId(u.id);
    setEditName(u.name);
    setEditMethod(u.printing_method);
  }

  async function saveEdit(id: string) {
    const name = editName.trim();
    if (!name) return;
    await patch(id, { name, printing_method: editMethod });
    setEditId(null);
  }

  return (
    <div className="space-y-5">
      {/* ── Add ─────────────────────────────────────────────── */}
      <form
        onSubmit={create}
        className="rounded-xl border border-black/[0.08] bg-white p-4 shadow-sm"
      >
        <h2 className="text-sm font-semibold text-[var(--glass-ink)] mb-3">Add a unit</h2>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2">
          <div>
            <label htmlFor="new-unit-name" className="sr-only">Unit name</label>
            <input
              id="new-unit-name"
              className={inputCls}
              placeholder="Unit name, e.g. Unit-3"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              disabled={creating}
            />
          </div>
          <div>
            <label htmlFor="new-unit-method" className="sr-only">Printing method</label>
            <select
              id="new-unit-method"
              className={inputCls}
              value={newMethod}
              onChange={(e) => setNewMethod(e.target.value as PrintingMethod)}
              disabled={creating}
            >
              {PRINTING_METHODS.map((m) => (
                <option key={m} value={m}>{m} Printing</option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={creating || !newName.trim()}
            className={cn(btnCls, 'bg-[var(--brand-accent)] text-white hover:opacity-90')}
          >
            {creating
              ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              : <Plus className="w-4 h-4" aria-hidden="true" />}
            Add unit
          </button>
        </div>
      </form>

      {error && (
        <p role="alert" className="text-sm text-red-600">{error}</p>
      )}

      {/* ── List ────────────────────────────────────────────── */}
      {loading ? (
        <p className="flex items-center gap-2 text-sm text-[var(--glass-muted)]">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          Loading units…
        </p>
      ) : units.length === 0 ? (
        <div className="rounded-xl border border-dashed border-black/[0.14] p-8 text-center">
          <p className="text-sm text-[var(--glass-ink)] font-medium">No printing units yet</p>
          <p className="text-sm text-[var(--glass-muted)] mt-1">
            Add one above. New jobs default to Flexo and will stay unassigned
            until a Flexo unit exists.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {units.map((u) => {
            const busy      = busyId === u.id;
            const isEditing = editId === u.id;
            const isDefault = defaultIds.has(u.id);

            return (
              <li
                key={u.id}
                className={cn(
                  'rounded-xl border border-black/[0.08] bg-white p-3 shadow-sm',
                  !u.is_active && 'opacity-60',
                )}
              >
                {isEditing ? (
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-2">
                    <label htmlFor={`edit-name-${u.id}`} className="sr-only">Unit name</label>
                    <input
                      id={`edit-name-${u.id}`}
                      className={inputCls}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      disabled={busy}
                    />
                    <label htmlFor={`edit-method-${u.id}`} className="sr-only">Printing method</label>
                    <select
                      id={`edit-method-${u.id}`}
                      className={inputCls}
                      value={editMethod}
                      onChange={(e) => setEditMethod(e.target.value as PrintingMethod)}
                      disabled={busy}
                    >
                      {PRINTING_METHODS.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => saveEdit(u.id)}
                      disabled={busy || !editName.trim()}
                      className={cn(btnCls, 'bg-emerald-600 text-white hover:bg-emerald-700')}
                    >
                      {busy
                        ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        : <Check className="w-4 h-4" aria-hidden="true" />}
                      Save
                    </button>
                    <button
                      onClick={() => setEditId(null)}
                      disabled={busy}
                      className={cn(btnCls, 'border border-black/[0.12] text-[var(--glass-ink)]')}
                    >
                      <X className="w-4 h-4" aria-hidden="true" />
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="font-mono text-sm font-semibold text-[var(--glass-ink)]">
                      {u.name}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-black/[0.06] text-[var(--glass-ink)]">
                      {u.printing_method}
                    </span>
                    {isDefault && (
                      <span
                        className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800"
                        title={`New ${u.printing_method} jobs are assigned to this unit`}
                      >
                        Default for {u.printing_method}
                      </span>
                    )}
                    {!u.is_active && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                        Retired
                      </span>
                    )}

                    <span className="ml-auto flex items-center gap-1.5">
                      <button
                        onClick={() => startEdit(u)}
                        disabled={busy}
                        className={cn(btnCls, 'border border-black/[0.12] text-[var(--glass-ink)]')}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => patch(u.id, { is_active: !u.is_active })}
                        disabled={busy}
                        className={cn(btnCls, 'border border-black/[0.12] text-[var(--glass-ink)]')}
                      >
                        {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                        {u.is_active ? 'Retire' : 'Reactivate'}
                      </button>
                      <button
                        onClick={() => remove(u)}
                        disabled={busy}
                        aria-label={`Delete ${u.name}`}
                        className={cn(btnCls, 'border border-red-200 text-red-700 hover:bg-red-50')}
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-[var(--glass-muted)]">
        A job&apos;s unit is auto-set from its printing method using the default
        unit above. Prepress can override it per job from the job card.
      </p>
    </div>
  );
}
