'use client';

// src/components/admin/PrintingUnitEdit.tsx
// ============================================================
// Printing unit control on the job card.
//
// The unit is the only thing asked for: each unit runs exactly one
// process (Unit-1 Offset, Unit-2 Flexo), so the method follows from it.
// PATCH /api/jobs/[id] reads the method off the chosen unit, which is
// what stops the two from drifting apart.
//
// The method is still shown — on the option labels, and as a warning if
// a job predating this rule carries a method its unit does not run.
// ============================================================

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { PrintingMethod, PrintingUnit } from '@/lib/types';
import { canDeptSetPrinting, type DeptPermissions } from '@/lib/constants/departments';
import { usePrintingUnits } from '@/hooks/useReferenceData';

const NO_UNITS: PrintingUnit[] = [];

interface Props {
  jobId: string;
  printingMethod: PrintingMethod;
  printingUnitId: string | null;
  /** Prepress, Production and Admin can change the unit; others read only. */
  dept: DeptPermissions | null;
  /** Fired after a successful save so the parent can refresh the job. */
  onSaved?: () => void;
  disabled?: boolean;
}

const selectCls =
  'w-full min-h-11 rounded-[10px] border border-brand-border bg-brand-surface-alt px-2.5 text-sm font-semibold ' +
  'text-brand-ink focus:border-brand-primary focus:bg-white focus:outline-none ' +
  'focus:shadow-[0_0_0_4px_rgba(16,85,63,0.12)] disabled:cursor-not-allowed disabled:opacity-50';

export default function PrintingUnitEdit({
  jobId,
  printingMethod,
  printingUnitId,
  dept,
  onSaved,
  disabled = false,
}: Props) {
  const canEdit = canDeptSetPrinting(dept);
  const [method, setMethod] = useState<PrintingMethod>(printingMethod);
  const [unitId, setUnitId] = useState<string | null>(printingUnitId);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  // Re-sync when the parent refetches the job (e.g. after another edit).
  useEffect(() => { setMethod(printingMethod); }, [printingMethod]);
  useEffect(() => { setUnitId(printingUnitId); }, [printingUnitId]);

  // Only active units are offered — a retired unit must not be assignable,
  // though a job already sitting on one keeps it until reassigned.
  const { data: units = NO_UNITS, isError: unitsFailed } = usePrintingUnits<PrintingUnit>();
  useEffect(() => {
    if (unitsFailed) setError('Could not load printing units');
  }, [unitsFailed]);

  async function save(patch: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(patch),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Update failed');

      // Trust the server's row, not the local guess: when only the method
      // was sent, the trigger picked the unit and the UI must reflect it.
      if (json.job) {
        setMethod(json.job.printing_method);
        setUnitId(json.job.printing_unit_id);
      }
      onSaved?.();
    } catch (e) {
      // Revert to the last known-good server values so the control never
      // shows a selection that was not actually persisted.
      setMethod(printingMethod);
      setUnitId(printingUnitId);
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  }

  const busy = saving || disabled || !canEdit;
  const assignedUnit = units.find((u) => u.id === unitId);
  // A job can hold a unit that belongs to the other method (deliberate override).
  const unitMismatch = assignedUnit && assignedUnit.printing_method !== method;

  const notice =
    saving ? null
    : error ? <p className="text-xs text-brand-danger">{error}</p>
    // Only legacy rows can land here — since the method became
    // unit-derived, no form can create this state. Reassigning the
    // unit rewrites the method and clears it.
    : unitMismatch ? (
      <p className="text-xs text-brand-warning">
        Recorded as {method} but {assignedUnit.name} runs {assignedUnit.printing_method}. Pick the unit again to correct it.
      </p>
    )
    : units.length === 0 ? <p className="text-xs text-brand-muted">No printing units yet — an Admin must add one.</p>
    : null;

  // Departments that can't change the unit just read it.
  if (!canEdit) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-[15px] font-semibold text-brand-ink">
          {assignedUnit ? `${assignedUnit.name} · ${assignedUnit.printing_method}` : 'Unassigned'}
        </span>
        {notice}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={`printing-unit-${jobId}`} className="sr-only">Printing unit</label>
      <div className="relative">
        <select
          id={`printing-unit-${jobId}`}
          className={selectCls}
          value={unitId ?? ''}
          disabled={busy || units.length === 0}
          onChange={(e) => {
            const next = e.target.value || null;
            setUnitId(next);
            // Unit only — the endpoint derives the method from it.
            save({ printing_unit_id: next });
          }}
        >
          <option value="">Unassigned</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} · {u.printing_method}
            </option>
          ))}
        </select>
        {saving && (
          <Loader2 className="absolute right-8 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-brand-muted" aria-label="Saving" />
        )}
      </div>
      <div aria-live="polite">{notice}</div>
    </div>
  );
}
