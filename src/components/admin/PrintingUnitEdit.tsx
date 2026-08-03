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
import { canDeptSetPrinting, type Department } from '@/lib/constants/departments';

interface Props {
  jobId: string;
  printingMethod: PrintingMethod;
  printingUnitId: string | null;
  /** Prepress, Production and Admin can change the unit; others read only. */
  dept: Department | null;
  /** Fired after a successful save so the parent can refresh the job. */
  onSaved?: () => void;
  disabled?: boolean;
}

const selectCls =
  'w-full rounded-lg border border-black/[0.12] bg-white px-3 py-2 text-sm ' +
  'text-[var(--glass-ink)] min-h-[44px] ' +
  'focus:outline-none focus:ring-2 focus:ring-[var(--brand-accent)] focus:border-transparent ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

export default function PrintingUnitEdit({
  jobId,
  printingMethod,
  printingUnitId,
  dept,
  onSaved,
  disabled = false,
}: Props) {
  const canEdit = canDeptSetPrinting(dept);
  const [units,  setUnits]  = useState<PrintingUnit[]>([]);
  const [method, setMethod] = useState<PrintingMethod>(printingMethod);
  const [unitId, setUnitId] = useState<string | null>(printingUnitId);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  // Re-sync when the parent refetches the job (e.g. after another edit).
  useEffect(() => { setMethod(printingMethod); }, [printingMethod]);
  useEffect(() => { setUnitId(printingUnitId); }, [printingUnitId]);

  // Only active units are offered — a retired unit must not be assignable,
  // though a job already sitting on one keeps it until reassigned.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/printing-units');
        if (!res.ok) throw new Error('Could not load printing units');
        const json = await res.json();
        if (!cancelled) setUnits(json.units ?? []);
      } catch {
        if (!cancelled) setError('Could not load printing units');
      }
    })();
    return () => { cancelled = true; };
  }, []);

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

  return (
    <div className="space-y-2">
      <div>
        <label
          htmlFor={`printing-unit-${jobId}`}
          className="block text-xs font-medium text-[var(--glass-muted)] mb-1"
        >
          Printing Unit
        </label>
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
          <option value="">— Unassigned —</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} · {u.printing_method}
            </option>
          ))}
        </select>
      </div>

      <div aria-live="polite" className="min-h-[18px]">
        {saving && (
          <p className="flex items-center gap-1.5 text-xs text-[var(--glass-muted)]">
            <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
            Saving…
          </p>
        )}
        {!saving && error && (
          <p className="text-xs text-red-600">{error}</p>
        )}
        {/* Only legacy rows can land here — since the method became
            unit-derived, no form can create this state. Reassigning the
            unit rewrites the method and clears it. */}
        {!saving && !error && unitMismatch && (
          <p className="text-xs text-amber-700">
            This job is recorded as {method} but sits on {assignedUnit.name},
            which runs {assignedUnit.printing_method}. Pick the unit again to correct it.
          </p>
        )}
        {!saving && !error && units.length === 0 && (
          <p className="text-xs text-[var(--glass-muted)]">
            No printing units configured — an Admin must add one.
          </p>
        )}
        {!canEdit && (
          <p className="text-xs text-[var(--glass-muted)]">
            Only Prepress, Production or Admin can change the printing unit.
          </p>
        )}
      </div>
    </div>
  );
}
