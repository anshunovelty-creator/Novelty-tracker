'use client';
// src/components/admin/JobDetailClient.tsx
// Full job detail view for /admin/jobs/[id], Control Room layout:
//   header  — stage control, type/urgency, party — job, delivery, the numbers
//   left    — Pipeline (every stage, who and when) and releases / print runs
//   right   — Next step (the one button most visits need), shelf stock for
//             this PM code, internal notes, the shade card
// Holds all interactive state — the stage modals, delivery date edit.
// Receives initial job data from the server page; updates local state after changes.

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn, formatAdminDate, formatJobCardNumber, formatShortDate, formatQty } from '@/lib/utils';
import { CheckCircle2 } from 'lucide-react';
import { PIPELINE_STAGES, REPEAT_SKIPPED_STAGES, isPerReleaseStage, isBackwardMove, effectiveStageIndex, stageIndex } from '@/lib/constants/stages';
import { canDeptOverridePOClosed, canDeptConfirmSlitting, canDeptSetStage } from '@/lib/constants/departments';
import type { Job } from '@/lib/types';
import type { DeptPermissions } from '@/lib/constants/departments';
import type { Stage } from '@/lib/constants/stages';
import { ReleasesSection } from './HistoryPanel';
import JobShadeCardPanel from './JobShadeCardPanel';
import JobPipeline from './JobPipeline';
import JobNotesCard from './JobNotesCard';
import JobShelfStockCard from './JobShelfStockCard';
import { useJobDetail } from '@/hooks/useJobDetail';
import { useDepartments } from '@/hooks/useReferenceData';
import { deliveryWords, istToday } from '@/lib/jobViews';
import type { DepartmentRecord } from '@/lib/types';
import DeliveryDateEdit from './DeliveryDateEdit';
import StageSelect from './StageSelect';
import PrintingUnitEdit from './PrintingUnitEdit';
import { JOBS_CHANGED_EVENT } from '@/lib/constants/events';
import {
  SequentialWarningModal,
  RevertStageModal,
  OnHoldModal,
  QCModal,
  PartialDispatchModal,
  FullDispatchModal,
  ClosePOModal,
  ConfirmSlittingModal,
  partialDispatchPayload,
  fullDispatchPayload,
} from './modals';
import { postSlittingConfirmation, type StatusPayload } from '@/hooks/useJobActions';
import toast from 'react-hot-toast';

type Props = {
  initialJob: Job;
  dept:       DeptPermissions;
};

type ModalState =
  | { type: 'none' }
  | { type: 'warning'; targetStage: Stage; missingStage: Stage }
  | { type: 'on_hold' }
  | { type: 'qc' }
  | { type: 'partial_dispatch' }
  | { type: 'full_dispatch' }
  | { type: 'close_po' }
  | { type: 'revert'; targetStage: Stage }
  | { type: 'slitting' };

export default function JobDetailClient({ initialJob, dept }: Props) {
  const router = useRouter();
  const [job,          setJob]          = useState<Job>(initialJob);
  const [modal,        setModal]        = useState<ModalState>({ type: 'none' });
  const [submitting,   setSubmitting]   = useState(false);
  const [pendingStage, setPendingStage] = useState<Stage | null>(null);
  // Stage history, comments and schedules — shared by Pipeline, Notes and
  // Releases; refetched whenever the job row changes.
  const { detail, reload: reloadDetail, setDetail } = useJobDetail(initialJob.id, job.updated_at);
  const { data: departments } = useDepartments<DepartmentRecord>();
  const [pendingPayload, setPendingPayload] = useState<StatusPayload | null>(null);

  // router.refresh() re-runs the page's server query and hands down a fresh
  // initialJob — fold it into local state, or every refresh (a release
  // dispatch, a printing-unit change) would be fetched and then ignored.
  // Merged, not replaced, so fields only this component set stay put.
  useEffect(() => {
    setJob((prev) => ({ ...prev, ...initialJob }));
  }, [initialJob]);

  // A release dispatched down in the Releases panel changes this job's
  // quantities without touching our copy of it. One router.refresh() both
  // re-reads the job (via the effect above) and drops the client router
  // cache, so going back to /admin shows the new totals too — no separate
  // /api/jobs/[id] fetch needed.
  useEffect(() => {
    const refreshJob = () => router.refresh();
    window.addEventListener(JOBS_CHANGED_EVENT, refreshJob);
    return () => window.removeEventListener(JOBS_CHANGED_EVENT, refreshJob);
  }, [router]);

  const availableStages: Stage[] = [...PIPELINE_STAGES, 'On Hold'];
  if (canDeptOverridePOClosed(dept)) availableStages.push('PO Closed');
  let filteredStages = job.job_type === 'Repeat'
    ? availableStages.filter((s) => !REPEAT_SKIPPED_STAGES.includes(s as any))
    : availableStages;
  // Scheduled-release jobs: printing onward is advanced per release in the
  // Releases panel — only the once-per-job stages stay in this dropdown.
  if (job.is_scheduled_release) {
    filteredStages = filteredStages.filter((s) => !isPerReleaseStage(s));
  }

  // Completed stages — shown with ✓ in the dropdown
  const completedSet = new Set(
    (job.job_stage_timestamps ?? []).map((t) => t.stage)
  );

  // Forward-only guard — mirrors useJobActions for the table/card views, and
  // the server's own check in POST /api/jobs/[id]/status.
  const completedStages = (job.job_stage_timestamps ?? []).map((t) => t.stage as Stage);

  function isBackwardStage(stage: Stage): boolean {
    return isBackwardMove(job.status as Stage, stage, completedStages);
  }

  // ── Status change handlers (exact same logic as JobRow) ──────

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

      if (!res.ok) {
        toast.error(data.error ?? 'Failed to update status');
        return;
      }

      setJob(data.job);
      setPendingPayload(null);
      toast.success(`Status updated to "${payload.new_status}"`);
    } catch {
      toast.error('Network error. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // Covers the machine-board path, which sets job.status = 'Slitting'
  // directly and bypasses /status — see confirm-slitting/route.ts.
  async function confirmSlitting(rollsSlit: number | null) {
    setSubmitting(true);
    try {
      const result = await postSlittingConfirmation(job.id, rollsSlit);
      if ('error' in result) { toast.error(result.error); return; }
      setJob(result.job);
      setModal({ type: 'none' });
      if (rollsSlit) reloadDetail();
      toast.success('Slitting marked complete — QC can proceed');
    } finally {
      setSubmitting(false);
    }
  }

  const canConfirmSlitting =
    canDeptConfirmSlitting(dept) &&
    job.status === 'Slitting' &&
    !job.slitting_confirmed_at;

  // ── Derived display values ───────────────────────────────────

  // Print-run jobs track quantity via total_qty_dispatched;
  // classic jobs via dispatched_qty.
  const effectiveDispatched = job.has_partial_runs
    ? (job.total_qty_dispatched ?? 0)
    : (job.dispatched_qty ?? 0);
  const dispatchPct = job.label_qty
    ? Math.round((effectiveDispatched / job.label_qty) * 100)
    : 0;

  // ── Next step ────────────────────────────────────────────────
  // The stage after the furthest one reached (what resuming a held job
  // returns it to), in this job's own pipeline — Repeat and scheduled
  // releases drop stages. Who owns it comes from the department grid.
  const pipeline  = filteredStages.filter((s) => PIPELINE_STAGES.includes(s));
  const eff       = effectiveStageIndex(job.status as Stage, completedStages);
  const nextStage = pipeline.find((s) => stageIndex(s) > eff) ?? null;
  const owners    = nextStage
    ? (departments ?? [])
        .filter((d) => !d.is_super_admin && !d.is_read_only)
        .filter((d) => (d.all_stages || d.stages.includes(nextStage))
          && (!d.printing_method_scope || !job.printing_method || d.printing_method_scope === job.printing_method))
        .map((d) => d.display_name)
    : [];
  const canMoveNext = nextStage ? canDeptSetStage(dept, nextStage, job.printing_method) : false;
  const canHold     = !['On Hold', 'PO Closed', 'Dispatched'].includes(job.status) && canDeptSetStage(dept, 'On Hold', job.printing_method);
  const asks: Partial<Record<Stage, string>> = {
    'Quality Check':    'Asks for QC remarks.',
    'Partial Dispatch': 'Asks how many labels go now.',
    'Dispatched':       'Confirms the full quantity going out.',
  };

  const delivery = deliveryWords(job, istToday());
  const cardNo   = formatJobCardNumber(job.job_card_number);
  const CARD     = 'rounded-2xl border border-brand-border bg-white shadow-[0_2px_8px_rgba(12,42,32,0.04)]';

  // ── Render ───────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[13px] text-brand-muted">
        <Link href="/admin" className="flex min-h-8 items-center font-medium text-brand-primary hover:text-brand-primary-hover">All jobs</Link>
        <span aria-hidden="true">/</span>
        <span className="font-mono text-brand-ink">{cardNo ?? job.po_number}</span>
      </nav>

      {/* ── Header: stage, who/what, delivery, the numbers ───── */}
      <section className={cn(CARD, 'flex flex-wrap items-start justify-between gap-6 p-5 sm:p-6')}>
        <div className="flex min-w-0 flex-[1_1_520px] flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="w-full max-w-[300px]">
              <StageSelect
                job={job}
                dept={dept}
                actions={{ availableStages: filteredStages, completedSet, submitting, handleStageSelect }}
                jobLabel={cardNo ?? job.po_number}
                variant="card"
              />
            </div>
            <span className="inline-flex h-7 items-center rounded-lg bg-brand-sunken px-2.5 text-xs font-semibold text-brand-muted">{job.job_type}</span>
            {job.urgent && (
              <span className="inline-flex h-7 items-center rounded-lg bg-[#FEF2F2] px-2.5 font-mono text-xs font-semibold text-brand-danger">
                {job.urgent_priority != null ? `P${job.urgent_priority} · Urgent` : 'Urgent'}
              </span>
            )}
            {job.is_scheduled_release && <span className="inline-flex h-7 items-center rounded-lg bg-brand-sunken px-2.5 text-xs font-semibold text-brand-muted">Scheduled releases</span>}
            {job.has_partial_runs && <span className="inline-flex h-7 items-center rounded-lg bg-brand-sunken px-2.5 text-xs font-semibold text-brand-muted">Print runs</span>}
          </div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.025em] text-brand-ink sm:text-[30px]">
            {job.party}
            {job.job_name && <span className="font-normal text-brand-muted"> — {job.job_name}</span>}
          </h1>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-brand-muted">
            {cardNo && <span>Job card <span className="font-mono font-semibold text-brand-ink">{cardNo}</span></span>}
            <span>PO <span className="font-mono text-brand-ink">{job.po_number}</span>{job.po_date && <> · <span className="font-mono">{formatShortDate(job.po_date)}</span></>}</span>
            {job.pm_code && <span>PM code <span className="font-mono text-brand-ink">{job.pm_code}</span></span>}
            <span>Added <span className="font-mono">{formatAdminDate(job.created_at)}</span></span>
          </div>
        </div>

        <div className="flex flex-col items-start gap-1 sm:items-end">
          <span className="text-[10px] font-medium uppercase tracking-[0.025em] text-brand-muted">Delivery date</span>
          <div className="font-mono text-lg font-semibold">
            <DeliveryDateEdit
              jobId={job.id}
              deliveryDate={job.delivery_date}
              dept={dept}
              onUpdated={(date) => setJob((j) => ({ ...j, delivery_date: date }))}
            />
          </div>
          {delivery.text && (
            <span className={cn(
              'text-[13px] font-semibold',
              delivery.tone === 'late' ? 'text-brand-danger' : delivery.tone === 'soon' ? 'text-brand-warning' : 'text-brand-muted',
            )}>
              {delivery.tone === 'late' ? delivery.text : delivery.text === 'today' ? 'Due today' : `Due ${delivery.text}`}
            </span>
          )}
        </div>

        <dl className="grid flex-[1_1_100%] grid-cols-[repeat(auto-fit,minmax(min(150px,100%),1fr))] gap-px overflow-hidden rounded-xl border border-brand-line-soft bg-brand-line-soft">
          <Figure label="Ordered"><span className="font-mono text-lg font-semibold">{formatQty(job.label_qty)}</span></Figure>
          <Figure label="Dispatched">
            <span className={cn('font-mono text-lg font-semibold', effectiveDispatched === 0 && 'text-brand-muted')}>{formatQty(effectiveDispatched)}</span>
            {job.label_qty ? (
              <span className="mt-1 block h-1 w-full max-w-[120px] overflow-hidden rounded-full bg-brand-sunken" aria-hidden="true">
                <span className="block h-full rounded-full bg-brand-primary" style={{ width: `${Math.min(dispatchPct, 100)}%` }} />
              </span>
            ) : null}
          </Figure>
          <Figure label="Still to send">
            <span className="font-mono text-lg font-semibold">
              {job.label_qty ? formatQty(Math.max(0, (job.remaining_qty ?? job.label_qty - effectiveDispatched))) : '—'}
            </span>
          </Figure>
          <Figure label="Printing unit">
            <PrintingUnitEdit
              jobId={job.id}
              printingMethod={job.printing_method}
              printingUnitId={job.printing_unit_id}
              dept={dept}
              onSaved={() => router.refresh()}
            />
          </Figure>
        </dl>

        {job.notes && (
          <p className="flex-[1_1_100%] rounded-xl bg-brand-surface-alt px-3.5 py-2.5 text-[13px] text-brand-ink">
            <span className="font-semibold">Job note:</span> {job.notes}
          </p>
        )}
      </section>

      <div className="flex flex-wrap items-start gap-5">
        {/* ── Left: the pipeline and what ships when ─────────── */}
        <div className="flex min-w-0 flex-[999_1_640px] flex-col gap-5">
          <JobPipeline job={job} detail={detail} />
          {detail && (
            <ReleasesSection
              job={detail}
              isScheduledRelease={job.is_scheduled_release || detail.is_scheduled_release}
              dept={dept}
              variant="card"
              onChanged={() => { reloadDetail(); window.dispatchEvent(new Event(JOBS_CHANGED_EVENT)); }}
            />
          )}
        </div>

        {/* ── Right: what to do next, and what's around it ───── */}
        <aside className="flex min-w-0 flex-[1_1_360px] flex-col gap-5">
          <section aria-label="Next step" className={cn(CARD, 'flex flex-col gap-3.5 p-5')}>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium uppercase tracking-[0.025em] text-brand-muted">Next step</span>
              {job.status === 'PO Closed' ? (
                <>
                  <h2 className="text-lg font-semibold text-brand-ink">PO closed</h2>
                  <p className="text-[13px] leading-relaxed text-brand-muted">Nothing left to do on this job. It stays in reports and history.</p>
                </>
              ) : canConfirmSlitting ? (
                <>
                  <h2 className="text-lg font-semibold text-brand-ink">Confirm slitting</h2>
                  <p className="text-[13px] leading-relaxed text-brand-muted">Quality Check stays locked until slitting is confirmed.</p>
                </>
              ) : nextStage ? (
                <>
                  <h2 className="text-lg font-semibold text-brand-ink">
                    {job.status === 'On Hold' ? `Resume at ${nextStage}` : <>{job.status} <span aria-hidden="true">→</span><span className="sr-only">, then</span> {nextStage}</>}
                  </h2>
                  <p className="text-[13px] leading-relaxed text-brand-muted">
                    {job.is_scheduled_release && isPerReleaseStage(nextStage)
                      ? 'From printing onward this job moves per release — use Scheduled releases below.'
                      : <>{owners.length > 0 ? <>Owned by {owners.join(', ')}. </> : null}{asks[nextStage] ?? ''}</>}
                  </p>
                </>
              ) : (
                <>
                  <h2 className="text-lg font-semibold text-brand-ink">{job.status}</h2>
                  <p className="text-[13px] leading-relaxed text-brand-muted">
                    The pipeline is complete.{canDeptOverridePOClosed(dept) ? ' Close the PO once the party has everything.' : ''}
                  </p>
                </>
              )}
            </div>

            {job.status === 'Slitting' && job.slitting_confirmed_at && (
              <p className="flex items-center gap-1.5 text-[13px] font-semibold text-brand-success">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Slitting confirmed — ready for QC
              </p>
            )}

            {canConfirmSlitting ? (
              <button type="button" onClick={() => setModal({ type: 'slitting' })} disabled={submitting} className={PRIMARY}>
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Mark slitting complete
              </button>
            ) : nextStage && !(job.is_scheduled_release && isPerReleaseStage(nextStage)) ? (
              canMoveNext ? (
                <button type="button" onClick={() => handleStageSelect(nextStage)} disabled={submitting} className={PRIMARY}>
                  {job.status === 'On Hold' ? `Resume at ${nextStage}` : `Move to ${nextStage}`}
                </button>
              ) : (
                <p className="rounded-xl bg-brand-surface-alt px-3.5 py-2.5 text-[13px] text-brand-muted">
                  Your department can&rsquo;t set {nextStage}. Leave a note below and {owners[0] ?? 'the owner'} will see it.
                </p>
              )
            ) : !nextStage && job.status !== 'PO Closed' && canDeptOverridePOClosed(dept) ? (
              <button type="button" onClick={() => handleStageSelect('PO Closed')} disabled={submitting} className={PRIMARY}>
                Close PO
              </button>
            ) : null}

            {canHold && (
              <button
                type="button"
                onClick={() => handleStageSelect('On Hold')}
                disabled={submitting}
                className="flex min-h-11 items-center justify-center rounded-[10px] border border-brand-border bg-white px-3.5 text-sm font-medium text-brand-warning transition-colors hover:bg-brand-surface-alt disabled:opacity-50"
              >
                Put on hold
              </button>
            )}
          </section>

          <JobShelfStockCard pmCode={job.pm_code} jobId={job.id} />

          <JobNotesCard
            job={job}
            detail={detail}
            onAdded={(c) => setDetail((d) => (d ? { ...d, stage_comments: [...d.stage_comments, c] } : d))}
          />

          {/* Shade card cross-reference — read-only; see JobShadeCardPanel. */}
          <JobShadeCardPanel pmCode={job.pm_code} party={job.party} product={job.job_name} />
        </aside>
      </div>

      {/* ── Modals (same pattern as JobRow) ────────────────────── */}

      {modal.type === 'warning' && (
        <SequentialWarningModal
          targetStage={modal.targetStage}
          missingStage={modal.missingStage}
          isAdmin={dept.isSuperAdmin}
          onCancel={() => { setModal({ type: 'none' }); setPendingPayload(null); setPendingStage(null); }}
          onOverride={(overrideRemark) => {
            // Re-submit the stored payload (preserves qty/remark) with the
            // Admin override flag and justification remark.
            const stored = pendingPayload ?? { new_status: modal.targetStage };
            setPendingPayload(null);
            submitStatusChange({
              ...stored,
              override_prerequisite: true,
              override_remark:       overrideRemark,
            });
          }}
        />
      )}

      {modal.type === 'revert' && (
        <RevertStageModal
          job={job}
          completedStages={completedStages}
          currentStage={job.status}
          targetStage={modal.targetStage}
          onCancel={() => { setModal({ type: 'none' }); setPendingStage(null); }}
          onConfirm={(revertRemark) => {
            const target = modal.targetStage;
            setPendingStage(null);
            submitStatusChange({
              new_status:        target,
              override_backward: true,
              override_remark:   revertRemark,
            });
          }}
        />
      )}

      {modal.type === 'on_hold' && (
        <OnHoldModal
          job={job}
          onCancel={() => setModal({ type: 'none' })}
          onConfirm={(remark) =>
            submitStatusChange({ new_status: 'On Hold', remark })
          }
        />
      )}

      {modal.type === 'qc' && (
        <QCModal
          job={job}
          onReject={canDeptSetStage(dept, 'On Hold', job.printing_method)
            ? (remark) => { setPendingStage(null); submitStatusChange({ new_status: 'On Hold', remark }); }
            : undefined}
          onCancel={() => { setModal({ type: 'none' }); setPendingStage(null); }}
          onConfirm={(remark) => {
            const target = (pendingStage ?? 'Quality Check') as Stage;
            // Safety net: stages with their own modal must NEVER be submitted from
            // the QC remark box — they have required inputs (qty etc.). Route instead.
            if (target === 'Partial Dispatch') { setModal({ type: 'partial_dispatch' }); return; }
            if (target === 'Dispatched')       { setModal({ type: 'full_dispatch' });    return; }
            if (target === 'On Hold')          { setModal({ type: 'on_hold' });          return; }
            if (target === 'PO Closed')        { setModal({ type: 'close_po' });         return; }
            submitStatusChange({ new_status: target, remark });
          }}
        />
      )}

      {modal.type === 'partial_dispatch' && (
        <PartialDispatchModal
          job={job}
          remaining={job.remaining_qty ?? (job.label_qty ? job.label_qty - job.dispatched_qty : 0)}
          onCancel={() => setModal({ type: 'none' })}
          onConfirm={(d) => submitStatusChange(partialDispatchPayload(d))}
        />
      )}

      {modal.type === 'full_dispatch' && (
        <FullDispatchModal
          job={job}
          remaining={job.remaining_qty ?? (job.label_qty ? job.label_qty - job.dispatched_qty : 0)}
          onCancel={() => setModal({ type: 'none' })}
          onConfirm={(d) => submitStatusChange(fullDispatchPayload(d))}
        />
      )}

      {modal.type === 'slitting' && (
        <ConfirmSlittingModal
          job={job}
          busy={submitting}
          onCancel={() => setModal({ type: 'none' })}
          onConfirm={confirmSlitting}
        />
      )}

      {modal.type === 'close_po' && (
        <ClosePOModal
          job={job}
          onCancel={() => setModal({ type: 'none' })}
          onConfirm={() =>
            submitStatusChange({ new_status: 'PO Closed' })
          }
        />
      )}
    </div>
  );
}

// ── Small helpers ───────────────────────────────────────────────

const PRIMARY = cn(
  'flex min-h-12 items-center justify-center gap-2 rounded-[10px] bg-brand-primary px-4 text-[15px] font-semibold text-white',
  'transition-colors hover:bg-brand-primary-hover disabled:opacity-50',
);

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 bg-white px-3.5 py-3 text-brand-ink">
      <dt className="text-[10px] font-medium uppercase tracking-[0.025em] text-brand-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
