'use client';
// src/components/admin/BomMaterialsManager.tsx
// The material master behind Bill of Material: one row per raw material
// with its ₹ per square metre. Every expense on the costing sheet is
// computed from this list, live — change a rate here and every job costed
// with that material reprices.
//
// Admin (bom_decide) adds, edits, retires and restores; everyone else with
// BOM access reads. A material with no rate yet is flagged, because it
// shows in the costing dropdown but can't price a job until the rate is in.

import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Check, X, Archive, ArchiveRestore, Trash2, AlertTriangle, Layers } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, formatNumericDate } from '@/lib/utils';
import { formatInr } from '@/lib/bom';
import type { BomMaterial } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { SkeletonRows } from '@/components/ui/Skeleton';

const EMPTY: BomMaterial[] = [];

type Draft = { name: string; specification: string; rate: string };

function blankDraft(): Draft {
  return { name: '', specification: '', rate: '' };
}

function draftFrom(material: BomMaterial): Draft {
  return {
    name:          material.name,
    specification: material.specification ?? '',
    rate:          material.rate_per_sqm > 0 ? String(material.rate_per_sqm) : '',
  };
}

type Props = { canManage: boolean };

export default function BomMaterialsManager({ canManage }: Props) {
  const queryClient = useQueryClient();

  const [adding,    setAdding]    = useState(false);
  const [addDraft,  setAddDraft]  = useState<Draft>(blankDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(blankDraft());
  const [busyId,    setBusyId]    = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showRetired, setShowRetired] = useState(false);

  const materialsQuery = useQuery({
    queryKey: ['bom-materials'],
    queryFn: async () => {
      const res  = await fetch('/api/bom-materials');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load materials');
      return (data.materials ?? []) as BomMaterial[];
    },
  });
  const materials = materialsQuery.data ?? EMPTY;
  const loading   = materialsQuery.isLoading;

  useEffect(() => {
    if (materialsQuery.error) toast.error((materialsQuery.error as Error).message);
  }, [materialsQuery.error]);

  const visible = showRetired ? materials : materials.filter((m) => m.is_active);
  const retiredCount = materials.length - materials.filter((m) => m.is_active).length;
  const unrated = materials.filter((m) => m.is_active && !(m.rate_per_sqm > 0)).length;

  // Every write invalidates both this list and the costing sheet — a rate
  // change reprices rows the other tab is showing.
  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['bom-materials'] });
    queryClient.invalidateQueries({ queryKey: ['bom-costings'] });
  }

  function validate(draft: Draft): { name: string; specification: string; rate_per_sqm: number } | null {
    const name = draft.name.trim();
    if (!name) { toast.error('Material name is required'); return null; }
    const rate = Number(draft.rate);
    if (!draft.rate.trim() || !Number.isFinite(rate) || rate < 0) {
      toast.error('Enter the rate per square metre');
      return null;
    }
    return { name, specification: draft.specification.trim(), rate_per_sqm: rate };
  }

  async function add() {
    const body = validate(addDraft);
    if (!body) return;
    setBusyId('new');
    try {
      const res  = await fetch('/api/bom-materials', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Failed to add material'); return; }
      toast.success(`${body.name} added`);
      setAddDraft(blankDraft());
      setAdding(false);
      refresh();
    } catch {
      toast.error('Network error');
    } finally {
      setBusyId(null);
    }
  }

  async function patch(material: BomMaterial, body: Record<string, unknown>, done: string) {
    setBusyId(material.id);
    try {
      const res  = await fetch(`/api/bom-materials/${material.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Failed to update material'); return false; }
      toast.success(done);
      refresh();
      return true;
    } catch {
      toast.error('Network error');
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function saveEdit(material: BomMaterial) {
    const body = validate(editDraft);
    if (!body) return;
    const ok = await patch(material, body, `${body.name} saved`);
    if (ok) setEditingId(null);
  }

  async function remove(material: BomMaterial) {
    setBusyId(material.id);
    try {
      const res  = await fetch(`/api/bom-materials/${material.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Failed to delete'); return; }
      toast.success(`${material.name} deleted`);
      refresh();
    } catch {
      toast.error('Network error');
    } finally {
      setBusyId(null);
      setConfirmDeleteId(null);
    }
  }

  const columns = canManage
    ? ['Material', 'Specification', '₹ / m²', 'Updated', 'Actions']
    : ['Material', 'Specification', '₹ / m²', 'Updated'];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-[var(--glass-muted)]">
          <strong className="text-[var(--glass-ink)]">{visible.length}</strong>
          {' '}{visible.length === 1 ? 'material' : 'materials'}
          {unrated > 0 && (
            <span className="ml-2 inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              {unrated} without a rate
            </span>
          )}
        </p>
        <div className="flex-1" />
        {retiredCount > 0 && (
          <label className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--glass-muted)]">
            <input
              type="checkbox"
              checked={showRetired}
              onChange={(e) => setShowRetired(e.target.checked)}
              className="h-4 w-4 rounded border-black/[0.2] accent-[#10553F]"
            />
            Show retired ({retiredCount})
          </label>
        )}
        {canManage && (
          <Button intent="primary" icon={adding ? X : Plus} onClick={() => { setAdding((o) => !o); setAddDraft(blankDraft()); }}>
            {adding ? 'Cancel' : 'Add material'}
          </Button>
        )}
      </div>

      {adding && canManage && (
        <div className="rounded-xl glass p-4">
          <h3 className="text-sm font-semibold text-[var(--glass-ink)]">New material</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-[2fr_2fr_1fr_auto] sm:items-end">
            <Field label="Name">
              <input autoFocus value={addDraft.name} onChange={(e) => setAddDraft({ ...addDraft, name: e.target.value })}
                     onKeyDown={(e) => { if (e.key === 'Enter') add(); }} placeholder="Chromo Paper 80gsm" className={cn(inputClass, 'w-full')} />
            </Field>
            <Field label="Specification (optional)">
              <input value={addDraft.specification} onChange={(e) => setAddDraft({ ...addDraft, specification: e.target.value })}
                     onKeyDown={(e) => { if (e.key === 'Enter') add(); }} placeholder="gsm / micron / finish" className={cn(inputClass, 'w-full')} />
            </Field>
            <Field label="₹ per m²">
              <input type="number" min="0" step="any" inputMode="decimal" value={addDraft.rate}
                     onChange={(e) => setAddDraft({ ...addDraft, rate: e.target.value })}
                     onKeyDown={(e) => { if (e.key === 'Enter') add(); }} placeholder="0.00"
                     className={cn(inputClass, 'w-full font-mono tabular-nums text-right')} />
            </Field>
            <Button intent="primary" icon={Check} busy={busyId === 'new'} onClick={add}>Add</Button>
          </div>
        </div>
      )}

      <div className="rounded-xl glass overflow-hidden">
        <div className="table-scroll-wrapper max-h-[70vh] overflow-y-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col} scope="col" className={cn(
                    'sticky top-0 z-10 px-3 py-1.5 text-left text-[11px] font-semibold text-[var(--glass-muted)]',
                    'uppercase tracking-[0.06em] whitespace-nowrap bg-[var(--glass-bg-strong)] backdrop-blur-[14px] border-b border-white/12',
                    (col === '₹ / m²' || col === 'Actions') && 'text-right',
                  )}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={4} cols={columns.length} />
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-12 text-center">
                    <Layers className="mx-auto h-6 w-6 text-[var(--glass-muted)]" aria-hidden="true" />
                    <p className="mt-3 text-sm font-medium text-[var(--glass-ink)]">No materials yet</p>
                    <p className="mt-1 text-xs text-[var(--glass-muted)]">
                      {canManage ? 'Add the papers and films the floor costs jobs with, each with its ₹ per m².' : 'Admin adds materials and their rates here.'}
                    </p>
                  </td>
                </tr>
              ) : visible.map((m, i) => {
                const editing = editingId === m.id;
                const busy = busyId === m.id;
                return (
                  <tr key={m.id} className={cn(
                    'border-b border-white/8 transition-colors hover:bg-black/[0.03]',
                    i % 2 === 1 && 'bg-[var(--glass-bg)]',
                    !m.is_active && 'text-[var(--glass-muted)]',
                  )}>
                    {editing ? (
                      <>
                        <td className="px-3 py-1.5">
                          <input autoFocus value={editDraft.name} onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                                 onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(m); if (e.key === 'Escape') setEditingId(null); }}
                                 aria-label="Material name" className={cn(inputClass, 'min-h-9 w-full')} />
                        </td>
                        <td className="px-3 py-1.5">
                          <input value={editDraft.specification} onChange={(e) => setEditDraft({ ...editDraft, specification: e.target.value })}
                                 onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(m); if (e.key === 'Escape') setEditingId(null); }}
                                 aria-label="Specification" className={cn(inputClass, 'min-h-9 w-full')} />
                        </td>
                        <td className="px-3 py-1.5">
                          <input type="number" min="0" step="any" inputMode="decimal" value={editDraft.rate}
                                 onChange={(e) => setEditDraft({ ...editDraft, rate: e.target.value })}
                                 onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(m); if (e.key === 'Escape') setEditingId(null); }}
                                 aria-label="Rate per square metre" className={cn(inputClass, 'min-h-9 w-full font-mono tabular-nums text-right')} />
                        </td>
                        <td className="px-3 py-1.5 text-xs">{formatNumericDate(m.updated_at)}</td>
                        <td className="px-3 py-1.5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <Button intent="primary" size="sm" icon={Check} busy={busy} onClick={() => saveEdit(m)}>Save</Button>
                            <Button size="sm" icon={X} onClick={() => setEditingId(null)} aria-label="Cancel edit" />
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className={cn('px-3 py-1.5 font-semibold whitespace-normal break-words', m.is_active && 'text-[var(--glass-ink)]')}>
                          {m.name}
                          {!m.is_active && <span className="ml-2 rounded-md border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">Retired</span>}
                        </td>
                        <td className="px-3 py-1.5 whitespace-normal break-words text-[var(--glass-muted)]">{m.specification ?? '—'}</td>
                        <td className={cn('px-3 py-1.5 font-mono tabular-nums text-right whitespace-nowrap', m.is_active && 'text-[var(--glass-ink)]')}>
                          {m.rate_per_sqm > 0 ? formatInr(m.rate_per_sqm) : (
                            <span className="inline-flex items-center gap-1 font-sans text-xs font-medium text-amber-800">
                              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                              Set rate
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-xs whitespace-nowrap text-[var(--glass-muted)]">
                          {formatNumericDate(m.updated_at)}
                          {m.updated_by && <span className="block truncate max-w-[160px]">{m.updated_by}</span>}
                        </td>
                        {canManage && (
                          <td className="px-3 py-1.5 text-right whitespace-nowrap">
                            {confirmDeleteId === m.id ? (
                              <div className="inline-flex items-center gap-1.5">
                                <Button intent="danger" size="sm" busy={busy} onClick={() => remove(m)}>Delete for good</Button>
                                <Button size="sm" onClick={() => setConfirmDeleteId(null)}>Keep</Button>
                              </div>
                            ) : (
                              <div className="inline-flex items-center gap-1.5">
                                <Button size="sm" icon={Pencil} disabled={busy}
                                        onClick={() => { setEditingId(m.id); setEditDraft(draftFrom(m)); setConfirmDeleteId(null); }}
                                        aria-label={`Edit ${m.name}`} title="Edit" />
                                {m.is_active ? (
                                  <Button size="sm" icon={Archive} busy={busy}
                                          onClick={() => patch(m, { is_active: false }, `${m.name} retired`)}
                                          aria-label={`Retire ${m.name}`} title="Retire — keeps old costings, drops it from the dropdown" />
                                ) : (
                                  <Button size="sm" icon={ArchiveRestore} busy={busy}
                                          onClick={() => patch(m, { is_active: true }, `${m.name} restored`)}
                                          aria-label={`Restore ${m.name}`} title="Restore to the dropdown" />
                                )}
                                <Button intent="danger" size="sm" icon={Trash2} disabled={busy}
                                        onClick={() => setConfirmDeleteId(m.id)}
                                        aria-label={`Delete ${m.name}`} title="Delete — only if no job is costed with it" />
                              </div>
                            )}
                          </td>
                        )}
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const inputClass =
  'min-h-11 px-3 rounded-lg text-sm bg-[var(--field-bg)] border border-[var(--field-border)] text-[var(--glass-ink)] ' +
  'placeholder:text-[var(--glass-muted)] focus:outline-none focus:border-emerald-300/70 ' +
  'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-[var(--glass-muted)]">{label}</span>
      {children}
    </label>
  );
}
