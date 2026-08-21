'use client';
// src/hooks/useJobActions.ts
// Every stage-change rule for a job in the admin list lives here.
//
// Two components drive the same job: JobRow (the table, sm and up) and JobCard
// (phones, below sm). They look nothing alike but the rules behind them — which
// stages a dept may pick, which stages need a modal first, how a 409
// PREREQUISITE_MISSING is recovered, what delete does — are identical. Keeping
// them in one hook is what stops the phone view from drifting out of sync with
// the desk view.

import { useState } from 'react';
import toast from 'react-hot-toast';
import { PIPELINE_STAGES, REPEAT_SKIPPED_STAGES, isPerReleaseStage } from '@/lib/constants/stages';
import { ROW_URGENCY_STYLES } from '@/lib/constants/statusColors';
import { canDeptOverridePOClosed, canDeptConfirmSlitting } from '@/lib/constants/departments';
import type { Job } from '@/lib/types';
import type { DeptPermissions } from '@/lib/constants/departments';
import type { Stage } from '@/lib/constants/stages';

export type JobModalState =
  | { type: 'none' }
  | { type: 'warning'; targetStage: Stage; missingStage: Stage }
  | { type: 'on_hold' }
  | { type: 'qc' }
  | { type: 'partial_dispatch' }
  | { type: 'full_dispatch' }
  | { type: 'close_po' }
  | { type: 'delete' };

export type StatusPayload = {
  new_status:             Stage;
  remark?:                string;
  qty_dispatched?:        number;
  override_prerequisite?: boolean;
  override_remark?:       string;
  // Label stock — see StatusChangePayload. Dispatch confirms what stays on
  // the shelf at a partial dispatch, and reports surplus at a full dispatch.
  stock_remaining_qty?:   number;
  extra_label_qty?:       number;
  extra_label_location?:  string;
  extra_label_remark?:    string;
};

type Params = {
  job:          Job;
  dept:         DeptPermissions;
  onJobUpdated: (job: Job) => void;
  onJobDeleted: (id: string) => void;
};

export type JobActions = ReturnType<typeof useJobActions>;

export function useJobActions({ job, dept, onJobUpdated, onJobDeleted }: Params) {
  const [pendingStage,   setPendingStage]   = useState<Stage | null>(null);
  const [modal,          setModal]          = useState<JobModalState>({ type: 'none' });
  const [submitting,     setSubmitting]     = useState(false);
  const [deleting,       setDeleting]       = useState(false);
  const [pendingPayload, setPendingPayload] = useState<StatusPayload | null>(null);

  // ── Submit status change ────────────────────────────────────
  async function submitStatusChange(payload: StatusPayload) {
    setSubmitting(true);
    setModal({ type: 'none' });

    try {
      const res = await fetch(`/api/jobs/${job.id}/status`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      const data = await res.json();

      if (res.status === 409 && data.error === 'PREREQUISITE_MISSING') {
        setPendingPayload({
          new_status:     payload.new_status,
          remark:         payload.remark,
          qty_dispatched: payload.qty_dispatched,
        });
        setModal({
          type:         'warning',
          targetStage:  payload.new_status,
          missingStage: data.missing_stage,
        });
        return;
      }

      if (!res.ok) {
        toast.error(data.error ?? 'Failed to update status');
        return;
      }

      onJobUpdated(data.job);
      toast.success(`Status updated to "${payload.new_status}"`);
      setPendingStage(null);
      setPendingPayload(null);
    } catch {
      toast.error('Network error. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Confirm slitting (Postpress / Admin only) ───────────────
  // Covers the machine-board path, which sets job.status = 'Slitting'
  // directly and bypasses /status — see confirm-slitting/route.ts.
  async function confirmSlitting() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/jobs/${job.id}/confirm-slitting`, { method: 'POST' });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error ?? 'Failed to confirm slitting');
        return;
      }

      onJobUpdated(data.job);
      toast.success('Slitting marked complete — QC can proceed');
    } catch {
      toast.error('Network error. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const canConfirmSlitting =
    canDeptConfirmSlitting(dept) &&
    job.status === 'Slitting' &&
    !job.slitting_confirmed_at;

  // ── Stage picker change handler ─────────────────────────────
  async function handleStageSelect(newStage: Stage) {
    if (newStage === job.status) return;
    setPendingStage(newStage);

    // Modal-required stages always use their OWN modal — even when leaving Quality Check.
    // (A Partial Dispatch from QC still needs the qty input, not the QC remark box.)
    // Server enforces prerequisites; a 409 response triggers the warning after entry.
    if (newStage === 'On Hold')          { setModal({ type: 'on_hold' });          return; }
    if (newStage === 'Quality Check')    { setModal({ type: 'qc' });               return; }
    if (newStage === 'Partial Dispatch') { setModal({ type: 'partial_dispatch' }); return; }
    if (newStage === 'Dispatched')       { setModal({ type: 'full_dispatch' });    return; }
    if (newStage === 'PO Closed')        { setModal({ type: 'close_po' });         return; }

    // Submit directly — the server is the source of truth for prerequisites
    // and responds 409 if the previous stage isn't complete.
    await submitStatusChange({ new_status: newStage });
  }

  // ── Admin override after a 409 ──────────────────────────────
  // Re-submits the stored payload (preserves qty/remark) with the override
  // flag and the Admin's written justification.
  function confirmOverride(overrideRemark: string, targetStage: Stage) {
    const stored = pendingPayload ?? { new_status: targetStage };
    setPendingPayload(null);
    submitStatusChange({
      ...stored,
      override_prerequisite: true,
      override_remark:       overrideRemark,
    });
  }

  function cancelOverride() {
    setModal({ type: 'none' });
    setPendingPayload(null);
    setPendingStage(null);
  }

  // ── Confirm from the QC remark box ──────────────────────────
  // Safety net: stages with their own modal must NEVER be submitted from the QC
  // remark box — they have required inputs (qty etc.). Route to the right one.
  function confirmQC(remark: string) {
    const target = (pendingStage ?? 'Quality Check') as Stage;
    if (target === 'Partial Dispatch') { setModal({ type: 'partial_dispatch' }); return; }
    if (target === 'Dispatched')       { setModal({ type: 'full_dispatch' });    return; }
    if (target === 'On Hold')          { setModal({ type: 'on_hold' });          return; }
    if (target === 'PO Closed')        { setModal({ type: 'close_po' });         return; }
    submitStatusChange({ new_status: target, remark });
  }

  // ── Delete job (Admin only) ─────────────────────────────────
  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/jobs/${job.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? 'Failed to delete job');
        return;
      }
      onJobDeleted(job.id);
      toast.success('Job deleted');
    } catch {
      toast.error('Network error. Try again.');
    } finally {
      setDeleting(false);
      setModal({ type: 'none' });
    }
  }

  function closeModal() {
    setModal({ type: 'none' });
  }

  function closeQCModal() {
    setModal({ type: 'none' });
    setPendingStage(null);
  }

  // ── Available stages in the picker ──────────────────────────
  const _stages: Stage[] = [...PIPELINE_STAGES, 'On Hold'];
  if (canDeptOverridePOClosed(dept)) _stages.push('PO Closed');
  let availableStages = job.job_type === 'Repeat'
    ? _stages.filter((s) => !REPEAT_SKIPPED_STAGES.includes(s as any))
    : _stages;
  // Scheduled-release jobs: printing onward is advanced per release in the
  // job's Releases panel — only the once-per-job stages stay in the picker.
  if (job.is_scheduled_release) {
    availableStages = availableStages.filter((s) => !isPerReleaseStage(s));
  }

  // Completed stages — shown with ✓ in the picker
  const completedSet = new Set(
    (job.job_stage_timestamps ?? []).map((t) => t.stage)
  );

  // ── Dispatch progress ───────────────────────────────────────
  // Print-run jobs track quantity via total_qty_dispatched;
  // classic jobs via dispatched_qty.
  const effectiveDispatched = job.has_partial_runs
    ? (job.total_qty_dispatched ?? 0)
    : (job.dispatched_qty ?? 0);
  const dispatchPct = job.label_qty
    ? Math.round((effectiveDispatched / job.label_qty) * 100)
    : 0;

  const remainingQty =
    job.remaining_qty ?? (job.label_qty ? job.label_qty - job.dispatched_qty : 0);

  // ── Urgency tint (On Hold > QC > urgent priority) ───────────
  // The same background class works on a <tr> and on a card <article>.
  const urgencyTint =
    job.status === 'On Hold'
      ? ROW_URGENCY_STYLES.onHold
      : job.status === 'Quality Check'
        ? ROW_URGENCY_STYLES.qc
        : job.urgent
          ? job.urgent_priority === 1
            ? ROW_URGENCY_STYLES.urgent1
            : job.urgent_priority === 2
              ? ROW_URGENCY_STYLES.urgent2
              : ROW_URGENCY_STYLES.urgent3
          : ROW_URGENCY_STYLES.normal;

  return {
    modal,
    submitting,
    deleting,
    openDeleteModal: () => setModal({ type: 'delete' }),
    closeModal,
    closeQCModal,
    handleStageSelect,
    submitStatusChange,
    confirmOverride,
    cancelOverride,
    confirmQC,
    confirmSlitting,
    canConfirmSlitting,
    handleDelete,
    availableStages,
    completedSet,
    effectiveDispatched,
    dispatchPct,
    remainingQty,
    urgencyTint,
  };
}
