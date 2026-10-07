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
import { PIPELINE_STAGES, REPEAT_SKIPPED_STAGES, isPerReleaseStage, isBackwardMove } from '@/lib/constants/stages';
import { ROW_URGENCY_STYLES } from '@/lib/constants/statusColors';
import { canDeptOverridePOClosed, canDeptConfirmSlitting } from '@/lib/constants/departments';
import type { Job } from '@/lib/types';
import type { DeptPermissions } from '@/lib/constants/departments';
import type { Stage } from '@/lib/constants/stages';
import { NOT_YOUR_STAGE } from '@/lib/stageBlocked';
import { JOBS_CHANGED_EVENT } from '@/lib/constants/events';
import { enqueue, isNetworkFailure, newRequestId, statusHeaders } from '@/lib/offlineQueue';
import { showNotYourStage } from '@/components/admin/NotYourStageToast';

export type JobModalState =
  | { type: 'none' }
  | { type: 'warning'; targetStage: Stage; missingStage: Stage }
  | { type: 'on_hold' }
  | { type: 'qc' }
  | { type: 'partial_dispatch' }
  | { type: 'full_dispatch' }
  | { type: 'close_po' }
  | { type: 'revert'; targetStage: Stage }
  | { type: 'slitting' }
  | { type: 'delete' };

export type StatusPayload = {
  new_status:             Stage;
  remark?:                string;
  qty_dispatched?:        number;
  override_prerequisite?: boolean;
  override_backward?:     boolean;
  override_remark?:       string;
  // Label stock — see StatusChangePayload. Dispatch confirms what stays on
  // the shelf at a partial dispatch, and reports surplus at a full dispatch.
  stock_remaining_qty?:   number;
  stock_remaining_location?: string;
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

    // One key for this change, made before the first send: if the answer is
    // lost and the change is queued, the replay carries the same key and the
    // server won't apply it a second time (e.g. a Partial Dispatch's qty).
    const requestId = newRequestId();

    try {
      const res = await fetch(`/api/jobs/${job.id}/status`, {
        method:  'POST',
        headers: statusHeaders(requestId),
        body:    JSON.stringify(payload),
      });
      const data = await res.json();

      if (res.status === 409 && data.error === 'PREREQUISITE_MISSING') {
        // Keep the whole body (qty, stock, rack, vehicle) for the Admin override retry.
        setPendingPayload({ ...payload });
        setModal({
          type:         'warning',
          targetStage:  payload.new_status,
          missingStage: data.missing_stage,
        });
        return;
      }

      if (res.status === 409 && data.error === 'BACKWARD_MOVE_BLOCKED') {
        toast.error(
          `Stages only move forward — "${data.target_stage}" is behind "${data.current_stage}".`
        );
        setPendingStage(null);
        setPendingPayload(null);
        return;
      }

      if (res.status === 403 && data.code === NOT_YOUR_STAGE) {
        showNotYourStage({ title: data.error, signedInAs: data.signed_in_as, jobId: job.id });
        setPendingStage(null);
        setPendingPayload(null);
        return;
      }

      // Someone saved this job in between — refresh the list so the
      // current stage is what's on screen before they try again.
      if (res.status === 409 && data.code === 'JOB_CHANGED') {
        toast.error(data.error);
        window.dispatchEvent(new Event(JOBS_CHANGED_EVENT));
        setPendingStage(null);
        setPendingPayload(null);
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
    } catch (err) {
      // No connection: keep the change on this device and let OfflineBanner
      // send it when the connection is back, rather than losing it.
      if (isNetworkFailure(err)) {
        enqueue({ jobId: job.id, poNumber: job.po_number, payload, requestId });
        toast(`No connection — ${job.po_number} → ${payload.new_status} saved on this device. It’ll sync automatically.`, { icon: '📶' });
        setPendingStage(null);
        setPendingPayload(null);
      } else {
        toast.error('Something went wrong. Try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ── Confirm slitting (Postpress / Admin only) ───────────────
  // Covers the machine-board path, which sets job.status = 'Slitting'
  // directly and bypasses /status — see confirm-slitting/route.ts.
  async function confirmSlitting(rollsSlit: number | null = null) {
    setSubmitting(true);
    try {
      const result = await postSlittingConfirmation(job.id, rollsSlit);
      if ('error' in result) { toast.error(result.error); return; }
      onJobUpdated(result.job);
      setModal({ type: 'none' });
      toast.success('Slitting marked complete — QC can proceed');
    } finally {
      setSubmitting(false);
    }
  }

  const canConfirmSlitting =
    canDeptConfirmSlitting(dept) &&
    job.status === 'Slitting' &&
    !job.slitting_confirmed_at;

  // ── Forward-only guard ──────────────────────────────────────
  // The dropdown lists the whole pipeline, so an earlier stage is always one
  // click away. The server refuses the move (409 BACKWARD_MOVE_BLOCKED); this
  // catches it first so nobody watches a stage change and then snap back.
  const completedStages = (job.job_stage_timestamps ?? []).map((t) => t.stage as Stage);

  function isBackwardStage(stage: Stage): boolean {
    return isBackwardMove(job.status as Stage, stage, completedStages);
  }

  // ── Stage picker change handler ─────────────────────────────
  async function handleStageSelect(newStage: Stage) {
    if (newStage === job.status) return;

    // Reverting rewrites what the client portal has already been shown, so it
    // is Admin-only and needs a written reason — same bar as skipping a
    // prerequisite. Everyone else is simply told the pipeline runs one way.
    if (isBackwardStage(newStage)) {
      if (!dept.isSuperAdmin) {
        toast.error(`Stages only move forward — "${newStage}" is behind "${job.status}". Ask Admin to revert it.`);
        return;
      }
      setPendingStage(newStage);
      setModal({ type: 'revert', targetStage: newStage });
      return;
    }

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

  // ── Admin revert to an earlier stage ────────────────────────
  // Goes straight to the server with the flag and the reason. Stages with
  // their own modal (QC, dispatch, On Hold) are never reached this way —
  // On Hold and PO Closed are not backward moves, and reverting INTO a
  // dispatch stage is refused server-side because the qty cannot be re-recorded.
  function confirmRevert(revertRemark: string, targetStage: Stage) {
    setPendingStage(null);
    submitStatusChange({
      new_status:        targetStage,
      override_backward: true,
      override_remark:   revertRemark,
    });
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

  // QC rejected the batch — the job stops on hold with QC's reason.
  function rejectQC(remark: string) {
    setPendingStage(null);
    submitStatusChange({ new_status: 'On Hold', remark });
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
    isBackwardStage,
    confirmRevert,
    confirmOverride,
    cancelOverride,
    confirmQC,
    rejectQC,
    openSlitting: () => setModal({ type: 'slitting' }),
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

/**
 * POST confirm-slitting, then — when a roll count was given — file it as an
 * internal note at Slitting (there is no column for it). The note is
 * best-effort: slitting is confirmed either way.
 */
export async function postSlittingConfirmation(
  jobId: string,
  rollsSlit: number | null,
): Promise<{ job: Job } | { error: string }> {
  try {
    const res  = await fetch(`/api/jobs/${jobId}/confirm-slitting`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) return { error: data.error ?? 'Failed to confirm slitting' };
    if (rollsSlit) {
      await fetch(`/api/jobs/${jobId}/comments`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          stage:   'Slitting',
          comment: `Slitting confirmed — ${rollsSlit.toLocaleString('en-IN')} rolls slit. Cores and winding checked against the job card.`,
        }),
      }).catch(() => undefined);
    }
    return { job: data.job as Job };
  } catch {
    return { error: 'Network error. Try again.' };
  }
}
