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
import { useQueryClient } from '@tanstack/react-query';
import { StateChip } from '@/components/ui/StateChip';
import { cn } from '@/lib/utils';
import { PRINTING_METHODS, type PrintingMethod, type PrintingUnit } from '@/lib/types';
import { ConfirmModal } from './modals';
import { PRINTING_UNITS_KEY } from '@/hooks/useReferenceData';

const inputCls =
  'w-full min-h-11 rounded-[10px] border border-brand-border bg-white px-3 text-sm text-brand-ink ' +
  'focus:border-brand-primary focus:outline-none focus:shadow-[0_0_0_4px_rgba(16,85,63,0.18)] ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

const btnCls =
  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] px-3 ' +
  'text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const quietBtn = cn(btnCls, 'border border-brand-border bg-white text-brand-ink hover:bg-brand-surface-alt');

// The unit's number in a dot coloured by its method — the same badge the
// press floor's "Print on" picker uses.
const METHOD_DOT: Record<string, string> = { Offset: '#DB2777', Flexo: '#047857' };

export default function PrintingUnitsManager() {
  const [units,   setUnits]   = useState<PrintingUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [busyId,  setBusyId]  = useState<string | null>(null);

  // New-unit form, folded behind "Add a unit"
  const [adding,    setAdding]    = useState(false);
  const [newName,   setNewName]   = useState('');
  const [newMethod, setNewMethod] = useState<PrintingMethod>('Flexo');
  const [creating,  setCreating]  = useState(false);

  // Inline edit
  const [editId,     setEditId]     = useState<string | null>(null);
  const [editName,   setEditName]   = useState('');
  const [editMethod, setEditMethod] = useState<PrintingMethod>('Flexo');

  const queryClient = useQueryClient();

  const load = useCallback(async () => {
    setError(null);
    try {
      // all=true so retired units stay visible and can be reactivated.
      const res  = await fetch('/api/printing-units?all=true');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load units');
      setUnits(json.units ?? []);
      // This page reads ?all=true (retired units included), so it can't seed
      // the shared active-only cache directly — mark it stale instead, so the
      // next job form picks up an added, renamed or retired unit.
      queryClient.invalidateQueries({ queryKey: PRINTING_UNITS_KEY });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load units');
    } finally {
      setLoading(false);
    }
  }, [queryClient]);

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
      setAdding(false);
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

  // Deleting unassigns every job on this unit (FK is ON DELETE SET NULL), so
  // the consequence is made explicit before it happens — in the app's own
  // danger dialog rather than window.confirm, which carried no danger colour
  // and could be dismissed with a stray Enter.
  const [pendingDelete, setPendingDelete] = useState<PrintingUnit | null>(null);

  async function confirmRemove() {
    const unit = pendingDelete;
    if (!unit) return;
    setPendingDelete(null);

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
    <section
      aria-labelledby="units-title"
      className="flex flex-col gap-4 rounded-2xl border border-brand-border bg-white p-5 shadow-[0_2px_8px_rgba(12,42,32,0.04)] sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="units-title" className="text-base font-semibold text-brand-ink">Printing units</h2>
          <p className="text-[13px] text-brand-muted">Jobs pick a unit; the printing method comes from it.</p>
        </div>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className={quietBtn}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Add a unit
          </button>
        )}
      </div>

      {adding && (
        <form onSubmit={create} className="grid grid-cols-1 gap-2 rounded-xl bg-brand-surface-alt p-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
          <div>
            <label htmlFor="new-unit-name" className="mb-1 block text-xs font-medium text-brand-muted">Unit name</label>
            <input
              id="new-unit-name"
              className={inputCls}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              disabled={creating}
              placeholder="Unit-3"
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="new-unit-method" className="mb-1 block text-xs font-medium text-brand-muted">Printing method</label>
            <select
              id="new-unit-method"
              className={inputCls}
              value={newMethod}
              onChange={(e) => setNewMethod(e.target.value as PrintingMethod)}
              disabled={creating}
            >
              {PRINTING_METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <button type="button" onClick={() => { setAdding(false); setNewName(''); }} disabled={creating} className={quietBtn}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={creating || !newName.trim()}
            className={cn(btnCls, 'bg-brand-primary font-semibold text-white hover:bg-brand-primary-hover')}
          >
            {creating && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Add unit
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className="text-sm text-brand-danger">{error}</p>
      )}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-brand-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading units…
        </p>
      ) : units.length === 0 ? (
        <div className="rounded-xl border border-dashed border-brand-border p-6 text-center">
          <p className="text-sm font-medium text-brand-ink">No printing units yet</p>
          <p className="mt-1 text-sm text-brand-muted">
            Add one. New jobs default to Flexo and stay unassigned until a Flexo unit exists.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col">
          {units.map((u) => {
            const busy      = busyId === u.id;
            const isEditing = editId === u.id;
            const isDefault = defaultIds.has(u.id);

            return (
              <li
                key={u.id}
                className={cn('border-t border-brand-line-soft py-3 first:border-t-0 first:pt-0', !u.is_active && 'opacity-60')}
              >
                {isEditing ? (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
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
                    <button onClick={() => setEditId(null)} disabled={busy} className={quietBtn}>
                      <X className="h-4 w-4" aria-hidden="true" /> Cancel
                    </button>
                    <button
                      onClick={() => saveEdit(u.id)}
                      disabled={busy || !editName.trim()}
                      className={cn(btnCls, 'bg-brand-primary font-semibold text-white hover:bg-brand-primary-hover')}
                    >
                      {busy
                        ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        : <Check className="h-4 w-4" aria-hidden="true" />}
                      Save
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span
                      aria-hidden="true"
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold text-white"
                      style={{ background: METHOD_DOT[u.printing_method] ?? '#64748B' }}
                    >
                      {u.name.replace(/\D/g, '') || u.name[0]}
                    </span>
                    <span className="text-sm font-semibold text-brand-ink">{u.name}</span>
                    <span className="text-sm text-brand-muted">{u.printing_method}</span>
                    {isDefault && (
                      <span title={`New ${u.printing_method} jobs are assigned to this unit`}>
                        <StateChip label="Default" dot="#059669" />
                      </span>
                    )}
                    {!u.is_active && (
                      <StateChip label="Retired" dot="#94A39B" className="font-medium text-brand-muted" />
                    )}

                    <span className="ml-auto flex items-center gap-1.5">
                      <button onClick={() => startEdit(u)} disabled={busy} className={quietBtn}>
                        Edit
                      </button>
                      <button onClick={() => patch(u.id, { is_active: !u.is_active })} disabled={busy} className={quietBtn}>
                        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                        {u.is_active ? 'Retire' : 'Reactivate'}
                      </button>
                      <button
                        onClick={() => setPendingDelete(u)}
                        disabled={busy}
                        aria-label={`Delete ${u.name}`}
                        className={cn(btnCls, 'w-11 px-0 text-brand-danger hover:bg-[#FEF2F2]')}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-brand-muted">
        &ldquo;Default&rdquo; is the unit a new job of that method lands on. Prepress can change it per job.
      </p>

      {pendingDelete && (
        <ConfirmModal
          title={`Delete ${pendingDelete.name}?`}
          message="Any job currently assigned to this unit will be left with no unit and must be reassigned. Retiring it instead keeps the history intact."
          confirmLabel="Delete unit"
          tone="danger"
          busy={busyId === pendingDelete.id}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmRemove}
        />
      )}
    </section>
  );
}
