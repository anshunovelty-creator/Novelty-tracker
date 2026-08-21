'use client';
// src/components/admin/DepartmentsManager.tsx
// Create departments and configure exactly which features, job-pipeline
// stages, and print-run stages each one may touch. Super-admin only —
// gated at the page level (perms.isSuperAdmin), same as the RLS write
// policies on departments/department_*_permissions (migration 040).
//
// Protected departments (Admin, Viewer) can't be deleted and always show
// their grids as read-only: Admin already has every permission implicitly
// (is_super_admin), and Viewer is intentionally the zero-permission floor
// enforced a second way by middleware's read-only backstop — editing
// either one's grid here would just be dead clicking.

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, ChevronDown, ShieldCheck, Eye, Lock } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { STAGES } from '@/lib/constants/stages';
import { RUN_STAGES, RUN_STAGE_LABELS } from '@/lib/constants/runStages';
import type { DepartmentRecord } from '@/lib/types';
import AddDepartmentModal from './AddDepartmentModal';

const FEATURES: { key: string; label: string }[] = [
  { key: 'printing_edit',                 label: 'Set printing method' },
  { key: 'job_detail_edit',                label: 'Edit job details' },
  { key: 'stock_edit',                     label: 'Manage label stock' },
  { key: 'dispatch_notifications',         label: 'Send dispatch emails' },
  { key: 'party_contacts_manage',          label: 'Manage party contacts' },
  { key: 'dies_plates_edit',               label: 'Manage dies & plates' },
  { key: 'job_separation_edit',            label: 'Manage job separation' },
  { key: 'prepress_todo_manage',           label: 'Manage Prepress Todo checklist' },
  { key: 'register_manage',                label: 'Access Register (Follow-ups)' },
  { key: 'bom_use',                        label: 'Access Bill of Materials' },
  { key: 'bom_decide',                     label: 'Decide BOM requests' },
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
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/departments');
      const data = await res.json();
      if (res.ok) setDepartments(data.departments ?? []);
      else toast.error(data.error ?? 'Failed to load departments');
    } catch {
      toast.error('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function remove(dept: DepartmentRecord) {
    if (!confirm(`Delete "${dept.display_name}"? Any user still assigned to it will lose access.`)) return;
    try {
      const res = await fetch(`/api/departments/${dept.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to delete department');
        return;
      }
      setDepartments((prev) => prev.filter((d) => d.id !== dept.id));
      toast.success(`${dept.display_name} deleted`);
    } catch {
      toast.error('Network error');
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        {!loading && (
          <p className="text-sm text-[var(--glass-muted)]">
            <strong className="text-[var(--glass-ink)]">{departments.length}</strong>{' '}
            {departments.length === 1 ? 'department' : 'departments'} configured
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
          Add department
        </button>
      </div>

      {loading ? (
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-black/[0.04]" />
          ))}
        </div>
      ) : (
        <ul className="space-y-2">
          {departments.map((dept) => (
            <DepartmentRow
              key={dept.id}
              dept={dept}
              expanded={expanded === dept.id}
              onToggle={() => setExpanded((cur) => (cur === dept.id ? null : dept.id))}
              onSaved={(updated) => {
                setDepartments((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
                toast.success(`${updated.display_name} saved`);
              }}
              onDelete={() => remove(dept)}
            />
          ))}
        </ul>
      )}

      {adding && (
        <AddDepartmentModal
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); load(); }}
        />
      )}
    </div>
  );
}

function DepartmentRow({
  dept, expanded, onToggle, onSaved, onDelete,
}: {
  dept: DepartmentRecord;
  expanded: boolean;
  onToggle: () => void;
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

  function toggle(list: string[], setList: (v: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
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
    <li className="rounded-xl border border-black/[0.08] bg-white overflow-hidden">
      <div className="p-4 flex items-center gap-3">
        <button
          onClick={onToggle}
          className="flex-1 min-w-0 flex items-center gap-3 text-left"
          aria-expanded={expanded}
        >
          <ChevronDown
            className={cn('w-4 h-4 shrink-0 text-[var(--glass-muted)] transition-transform', expanded && 'rotate-180')}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-[var(--glass-ink)]">{dept.display_name}</span>
              <span className="text-xs font-mono text-[var(--glass-muted)]">{dept.key}</span>
              {dept.is_super_admin && <Badge icon={ShieldCheck}>Super admin</Badge>}
              {dept.is_read_only && <Badge icon={Eye}>Read-only</Badge>}
              {dept.is_protected && <Badge icon={Lock}>Protected</Badge>}
            </div>
            {!expanded && (
              <p className="text-xs text-[var(--glass-muted)] mt-0.5">
                {dept.is_super_admin
                  ? 'Every feature, stage, and run stage — always'
                  : `${dept.features.length} feature${dept.features.length === 1 ? '' : 's'} · ${
                      dept.all_stages ? 'all stages' : `${dept.stages.length} stage${dept.stages.length === 1 ? '' : 's'}`
                    } · ${dept.run_stages.length} run stage${dept.run_stages.length === 1 ? '' : 's'}`}
              </p>
            )}
          </div>
        </button>
        {!dept.is_protected && (
          <button
            onClick={onDelete}
            aria-label={`Delete ${dept.display_name}`}
            className="shrink-0 inline-flex items-center justify-center gap-1.5 min-h-11 px-3 rounded-lg text-xs font-medium border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
            Delete
          </button>
        )}
      </div>

      {expanded && (
        <div className="px-4 pb-4 border-t border-black/[0.06] pt-4 space-y-4">
          {!editable ? (
            <p className="text-xs text-[var(--glass-muted)]">
              {dept.is_super_admin
                ? 'The super-admin department always has every permission automatically — nothing to configure.'
                : 'Viewer is the enforced read-only floor — middleware blocks every mutating request for it regardless of this grid, so there’s nothing meaningful to grant here.'}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Display name">
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="Client-facing name (optional)">
                  <input
                    value={clientFacingName}
                    onChange={(e) => setClientFacingName(e.target.value)}
                    placeholder={dept.display_name}
                    className={inputCls}
                  />
                </Field>
              </div>

              <Field label="Printing-method scope">
                <select
                  value={scope}
                  onChange={(e) => setScope(e.target.value as 'Offset' | 'Flexo' | '')}
                  className={cn(inputCls, 'appearance-none')}
                >
                  <option value="">None — not scoped to a unit</option>
                  <option value="Offset">Offset only</option>
                  <option value="Flexo">Flexo only</option>
                </select>
                <p className="text-xs text-[var(--glass-muted)] mt-1">
                  Restricts stage-setting to jobs on that printing method, no matter which stages are granted below.
                </p>
              </Field>

              <label className="flex items-center gap-2 text-sm text-[var(--glass-ink)]">
                <input
                  type="checkbox"
                  checked={allStages}
                  onChange={(e) => setAllStages(e.target.checked)}
                  className="w-4 h-4"
                />
                All stages (including any added later)
              </label>

              <CheckboxGrid
                label="Features"
                options={FEATURES}
                selected={features}
                onToggle={(key) => toggle(features, setFeatures, key)}
              />

              <CheckboxGrid
                label="Job stages"
                disabled={allStages}
                options={STAGES.map((s) => ({ key: s, label: s }))}
                selected={stages}
                onToggle={(key) => toggle(stages, setStages, key)}
              />

              <CheckboxGrid
                label="Print-run stages"
                options={RUN_STAGES.map((s) => ({ key: s, label: RUN_STAGE_LABELS[s] }))}
                selected={runStages}
                onToggle={(key) => toggle(runStages, setRunStages, key)}
              />

              <div className="flex justify-end">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-brand-primary text-white hover:bg-brand-primary/90 disabled:opacity-40 transition-colors"
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </li>
  );
}

const inputCls = cn(
  'w-full px-3 py-2 rounded-lg text-sm bg-[var(--glass-bg)] border border-[var(--glass-border)]',
  'text-[var(--glass-ink)] placeholder:text-[var(--glass-muted)]',
  'focus:outline-none focus:border-emerald-300/70 focus:bg-white/[0.14]',
  'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
);

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--glass-muted)] mb-1.5">
        {label}
      </span>
      {children}
    </div>
  );
}

function Badge({ icon: Icon, children }: { icon: typeof ShieldCheck; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide bg-black/[0.06] text-[var(--glass-muted)]">
      <Icon className="w-3 h-3" aria-hidden="true" />
      {children}
    </span>
  );
}

function CheckboxGrid({
  label, options, selected, onToggle, disabled,
}: {
  label: string;
  options: { key: string; label: string }[];
  selected: string[];
  onToggle: (key: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--glass-muted)] mb-1.5">
        {label}
      </span>
      <div className={cn('grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1.5', disabled && 'opacity-40 pointer-events-none')}>
        {options.map((opt) => (
          <label key={opt.key} className="flex items-center gap-1.5 text-xs text-[var(--glass-ink)]">
            <input
              type="checkbox"
              checked={selected.includes(opt.key)}
              onChange={() => onToggle(opt.key)}
              className="w-3.5 h-3.5 shrink-0"
            />
            <span className="truncate">{opt.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
