'use client';
// src/components/admin/DepartmentsManager.tsx
// Create departments and configure exactly which features, job-pipeline
// stages, and print-run stages each one may touch — a list on the left, the
// chosen department's editor on the right. Super-admin only —
// gated at the page level (perms.isSuperAdmin), same as the RLS write
// policies on departments/department_*_permissions (migration 040).
//
// Protected departments (Admin, Viewer) can't be deleted and always show
// their grids as read-only: Admin already has every permission implicitly
// (is_super_admin), and Viewer is intentionally the zero-permission floor
// enforced a second way by middleware's read-only backstop — editing
// either one's grid here would just be dead clicking.

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { STAGES } from '@/lib/constants/stages';
import { RUN_STAGES, RUN_STAGE_LABELS } from '@/lib/constants/runStages';
import type { DepartmentRecord } from '@/lib/types';
import { ConfirmModal } from './modals';
import AddDepartmentModal from './AddDepartmentModal';
import { DEPARTMENTS_KEY } from '@/hooks/useReferenceData';

const FEATURES: { key: string; label: string }[] = [
  { key: 'printing_edit',                 label: 'Set printing method' },
  { key: 'job_detail_edit',                label: 'Edit job details' },
  { key: 'stock_view',                     label: 'See label stock' },
  { key: 'stock_edit',                     label: 'Manage label stock (add, edit, dispatch, delete)' },
  { key: 'dispatch_notifications',         label: 'Send dispatch emails' },
  { key: 'box_slip_print',                 label: 'Print box slips' },
  { key: 'roll_slip_print',                label: 'Print roll slips' },
  { key: 'party_contacts_manage',          label: 'Manage party contacts' },
  { key: 'dies_plates_edit',               label: 'Manage dies & plates' },
  { key: 'shade_card_manage',              label: 'Manage shade cards' },
  { key: 'job_separation_edit',            label: 'Manage job separation' },
  { key: 'job_separation_total_view',      label: 'See money totals (Job Separation total, BOM totals, paper stock value)' },
  { key: 'prepress_todo_manage',           label: 'Manage Prepress Todo checklist' },
  { key: 'meter_calculator_use',           label: 'Use Meter Calculator' },
  { key: 'register_manage',                label: 'Access Register (Follow-ups)' },
  { key: 'bom_use',                        label: 'Access Bill of Material (cost jobs, request material)' },
  { key: 'bom_decide',                     label: 'Answer BOM requests & manage material rates' },
  { key: 'paper_stock_manage',             label: 'Manage paper stock (receive, adjust rolls)' },
  { key: 'notification_recipients_manage', label: 'Manage Dispatch Alerts recipients' },
  { key: 'team_manage',                    label: 'Manage team logins' },
  { key: 'export_data',                    label: 'Run data export' },
  { key: 'delivery_date_edit',             label: 'Edit delivery date' },
  { key: 'slitting_confirm',               label: 'Confirm slitting' },
  { key: 'print_run_manage',               label: 'Manage print runs' },
  { key: 'machine_board_manage',           label: 'Manage machine board' },
  { key: 'po_closed_override',             label: 'Override PO Closed' },
];

export default function DepartmentsManager() {
  const [departments, setDepartments] = useState<DepartmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/departments');
      const data = await res.json();
      if (res.ok) {
        setDepartments(data.departments ?? []);
        // Same endpoint the shared useDepartments() cache reads — hand it the
        // fresh list so every other component sees this page's edits at once.
        queryClient.setQueryData(DEPARTMENTS_KEY, data.departments ?? []);
      } else {
        toast.error(data.error ?? 'Failed to load departments');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setLoading(false);
    }
  }, [queryClient]);

  useEffect(() => { load(); }, [load]);

  // First editable department until someone picks one.
  const selected =
    departments.find((d) => d.id === selectedId) ??
    departments.find((d) => !d.is_protected) ??
    departments[0] ??
    null;

  function pick(id: string) {
    if (id === selected?.id) return;
    if (dirty) { setPendingSwitch(id); return; }
    setSelectedId(id);
  }

  // Deleting a department revokes access for everyone still assigned to it —
  // the most consequential action on this page, so it goes through
  // ConfirmModal rather than a one-click button.
  const [pendingDelete, setPendingDelete] = useState<DepartmentRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function confirmRemove() {
    const dept = pendingDelete;
    if (!dept) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/departments/${dept.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to delete department');
        return;
      }
      setDepartments((prev) => prev.filter((d) => d.id !== dept.id));
      setSelectedId(null);
      setDirty(false);
      toast.success(`${dept.display_name} deleted`);
      setPendingDelete(null);
    } catch {
      toast.error('Network error');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
      <nav
        aria-label="Departments"
        className="flex flex-col gap-0.5 rounded-2xl border border-brand-border bg-white p-2 shadow-[0_2px_8px_rgba(12,42,32,0.04)] lg:sticky lg:top-24 lg:w-[280px] lg:shrink-0"
      >
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => <div key={i} className="m-1 h-11 rounded-[10px] bg-brand-sunken" aria-hidden="true" />)
        ) : (
          departments.map((d) => {
            const on = d.id === selected?.id;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => pick(d.id)}
                aria-current={on ? 'true' : undefined}
                className={cn(
                  'flex min-h-[52px] items-center justify-between gap-2 rounded-[10px] px-3.5 text-left text-[15px] text-brand-ink transition-colors hover:bg-[#F4F8F5]',
                  on && 'bg-[#F4F8F5] font-semibold shadow-[inset_3px_0_0_#10553F]',
                )}
              >
                <span className="min-w-0 truncate">{d.display_name}</span>
                <DeptMeta dept={d} />
              </button>
            );
          })
        )}
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-1.5 flex min-h-12 items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-[#CFDAD3] text-sm font-semibold text-brand-primary transition-colors hover:bg-[#F4F8F5]"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add department
        </button>
      </nav>

      <div className="min-w-0 flex-1">
        {selected ? (
          <DepartmentEditor
            key={selected.id}
            dept={selected}
            onDirty={setDirty}
            onSaved={(updated) => {
              setDepartments((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
              queryClient.invalidateQueries({ queryKey: DEPARTMENTS_KEY });
              toast.success(`${updated.display_name} saved`);
            }}
            onDelete={() => setPendingDelete(selected)}
          />
        ) : !loading ? (
          <p className="rounded-2xl border border-dashed border-brand-border bg-white p-8 text-center text-sm text-brand-muted">
            No departments yet. Add one to start.
          </p>
        ) : null}
      </div>

      {adding && (
        <AddDepartmentModal
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); load(); }}
        />
      )}

      {pendingSwitch && (
        <ConfirmModal
          title={`Discard changes to ${selected?.display_name}?`}
          message="You have unsaved changes on this department."
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          tone="danger"
          onCancel={() => setPendingSwitch(null)}
          onConfirm={() => { setDirty(false); setSelectedId(pendingSwitch); setPendingSwitch(null); }}
        />
      )}

      {pendingDelete && (
        <ConfirmModal
          title={`Delete ${pendingDelete.display_name}?`}
          message="Any user still assigned to this department will lose access at their next sign-in. This cannot be undone."
          confirmLabel="Delete department"
          tone="danger"
          busy={deleting}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmRemove}
        />
      )}
    </div>
  );
}

/** The right-hand hint in the list: what's special, or how many stages. */
function DeptMeta({ dept }: { dept: DepartmentRecord }) {
  const tag =
    dept.is_super_admin ? 'Protected' :
    dept.is_read_only ? 'Read-only' :
    dept.printing_method_scope ? `${dept.printing_method_scope} only` :
    null;
  if (tag) {
    return <span className="shrink-0 rounded-full border border-brand-border bg-[#F1F5F2] px-2 py-0.5 text-[11px] font-normal text-brand-muted">{tag}</span>;
  }
  return (
    <span className="shrink-0 font-mono text-xs font-normal text-brand-muted">
      {dept.all_stages ? 'All stages' : `${dept.stages.length} stage${dept.stages.length === 1 ? '' : 's'}`}
    </span>
  );
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

function DepartmentEditor({
  dept, onDirty, onSaved, onDelete,
}: {
  dept: DepartmentRecord;
  onDirty: (dirty: boolean) => void;
  onSaved: (updated: DepartmentRecord) => void;
  onDelete: () => void;
}) {
  const editable = !dept.is_super_admin && !dept.is_read_only;

  const [displayName, setDisplayName] = useState(dept.display_name);
  const [clientFacingName, setClientFacingName] = useState(dept.client_facing_name ?? '');
  const [allStages, setAllStages] = useState(dept.all_stages);
  const [scope, setScope] = useState<'Offset' | 'Flexo' | ''>(dept.printing_method_scope ?? '');
  const [features, setFeatures] = useState<string[]>(dept.features);
  const [stages, setStages] = useState<string[]>(dept.stages);
  const [runStages, setRunStages] = useState<string[]>(dept.run_stages);
  const [saving, setSaving] = useState(false);

  const dirty =
    displayName.trim() !== dept.display_name ||
    (clientFacingName.trim() || null) !== (dept.client_facing_name ?? null) ||
    allStages !== dept.all_stages ||
    (scope || null) !== (dept.printing_method_scope ?? null) ||
    !sameSet(features, dept.features) ||
    !sameSet(stages, dept.stages) ||
    !sameSet(runStages, dept.run_stages);

  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);

  function toggle(list: string[], setList: (v: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  function discard() {
    setDisplayName(dept.display_name);
    setClientFacingName(dept.client_facing_name ?? '');
    setAllStages(dept.all_stages);
    setScope(dept.printing_method_scope ?? '');
    setFeatures(dept.features);
    setStages(dept.stages);
    setRunStages(dept.run_stages);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/departments/${dept.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name:          displayName.trim(),
          client_facing_name:    clientFacingName.trim() || null,
          printing_method_scope: scope || null,
          all_stages:            allStages,
          features,
          stages,
          run_stages:            runStages,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to save');
        return;
      }
      onSaved({ ...dept, ...data.department, features, stages, run_stages: runStages });
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      aria-labelledby={`dept-${dept.id}`}
      className="flex flex-col gap-6 rounded-2xl border border-brand-border bg-white p-5 shadow-[0_2px_8px_rgba(12,42,32,0.04)] sm:p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`dept-${dept.id}`} className="text-lg font-semibold text-brand-ink">{dept.display_name}</h2>
        <span className="font-mono text-xs text-brand-muted">{dept.key}</span>
      </div>

      {!editable ? (
        <p className="rounded-xl bg-brand-surface-alt px-4 py-3.5 text-sm leading-relaxed text-brand-muted">
          {dept.is_super_admin
            ? 'Admin always has every feature, stage and run stage — nothing to configure, and it can’t be deleted.'
            : 'This is the read-only floor: the server blocks every change it tries to make, whatever is granted here, so there is nothing to set.'}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Display name" htmlFor={`dn-${dept.id}`}>
              <input id={`dn-${dept.id}`} value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Client-facing name (optional)" htmlFor={`cf-${dept.id}`} hint={`Empty shows clients “${dept.display_name}”.`}>
              <input id={`cf-${dept.id}`} value={clientFacingName} onChange={(e) => setClientFacingName(e.target.value)} className={inputCls} />
            </Field>
          </div>

          <PillGroup label="Printing method" hint="Limits stage changes to jobs on that method, whatever stages are granted below.">
            {([['', 'Any job'], ['Flexo', 'Flexo only'], ['Offset', 'Offset only']] as const).map(([v, l]) => (
              <Pill key={l} on={scope === v} onClick={() => setScope(v)} role="radio">{l}</Pill>
            ))}
          </PillGroup>

          <PillGroup label="Stages it can set">
            <Pill on={allStages} onClick={() => setAllStages((v) => !v)}>All stages, including new ones</Pill>
            {STAGES.map((s) => (
              <Pill key={s} on={allStages || stages.includes(s)} disabled={allStages} onClick={() => toggle(stages, setStages, s)}>{s}</Pill>
            ))}
          </PillGroup>

          <PillGroup label="Print-run stages">
            {RUN_STAGES.map((s) => (
              <Pill key={s} on={runStages.includes(s)} onClick={() => toggle(runStages, setRunStages, s)}>{RUN_STAGE_LABELS[s]}</Pill>
            ))}
          </PillGroup>

          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.025em] text-brand-muted">Features</legend>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-x-6">
              {FEATURES.map((f) => (
                <label key={f.key} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-brand-ink">
                  <input
                    type="checkbox"
                    checked={features.includes(f.key)}
                    onChange={() => toggle(features, setFeatures, f.key)}
                    className="h-5 w-5 shrink-0 accent-brand-primary"
                  />
                  {f.label}
                </label>
              ))}
            </div>
          </fieldset>
        </>
      )}

      {(editable || !dept.is_protected) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-brand-line-soft pt-4">
          {!dept.is_protected && (
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] px-3 text-sm font-medium text-brand-danger transition-colors hover:bg-[#FEF2F2]"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete
            </button>
          )}
          {editable && (
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={discard}
                disabled={!dirty || saving}
                className="min-h-11 rounded-[10px] border border-brand-border bg-white px-4 text-sm font-medium text-brand-ink transition-colors hover:bg-brand-surface-alt disabled:opacity-40"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!dirty || saving || !displayName.trim()}
                className="min-h-11 rounded-[10px] bg-brand-primary px-[18px] text-sm font-semibold text-white transition-colors hover:bg-brand-primary-hover disabled:opacity-40"
              >
                {saving ? 'Saving…' : `Save ${displayName.trim() || dept.display_name}`}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

const inputCls = cn(
  'h-11 w-full rounded-[10px] border border-brand-border bg-white px-3 text-[15px] text-brand-ink',
  'focus:border-brand-primary focus:outline-none focus:shadow-[0_0_0_4px_rgba(16,85,63,0.18)]',
);

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[10px] font-medium uppercase tracking-[0.025em] text-brand-muted">{label}</label>
      {children}
      {hint && <p className="text-xs text-brand-muted">{hint}</p>}
    </div>
  );
}

function PillGroup({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-[10px] font-medium uppercase tracking-[0.025em] text-brand-muted">{label}</span>
      <div className="flex flex-wrap gap-2">{children}</div>
      {hint && <p className="text-xs text-brand-muted">{hint}</p>}
    </div>
  );
}

function Pill({
  on, disabled, onClick, role, children,
}: {
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
  role?: 'radio';
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-pressed={role ? undefined : on}
      aria-checked={role ? on : undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-10 items-center rounded-full border px-3 text-[13px] font-medium transition-colors disabled:cursor-not-allowed',
        on ? 'border-brand-primary bg-brand-primary text-white' : 'border-brand-border bg-white text-brand-muted hover:text-brand-ink',
        disabled && on && 'opacity-60',
      )}
    >
      {children}
    </button>
  );
}
