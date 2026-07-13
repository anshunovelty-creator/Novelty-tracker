'use client';
// src/components/admin/JobDetailClient.tsx
// Full job detail view for /admin/jobs/[id].
// Contains all interactive state — status dropdown, all 6 modals, delivery date edit.
// Receives initial job data from the server page; updates local state after changes.

import { useState } from 'react';
import Link from 'next/link';
import { cn, formatAdminDate, formatShortDate, formatQty } from '@/lib/utils';
import { STATUS_COLORS, JOB_TYPE_BADGE, urgentBadgeClass } from '@/lib/constants/statusColors';
import { PIPELINE_STAGES, REPEAT_SKIPPED_STAGES, isPerReleaseStage } from '@/lib/constants/stages';
import { canDeptSetStage } from '@/lib/constants/departments';
import type { Job } from '@/lib/types';
import type { Department } from '@/lib/constants/departments';
import type { Stage } from '@/lib/constants/stages';
import HistoryPanel from './HistoryPanel';
import DeliveryDateEdit from './DeliveryDateEdit';
import {
  SequentialWarningModal,
  OnHoldModal,
  QCModal,
  PartialDispatchModal,
  FullDispatchModal,
  ClosePOModal,
} from './modals';
import toast from 'react-hot-toast';

type Props = {
  initialJob: Job;
  dept:       Department;
};

type ModalState =
  | { type: 'none' }
  | { type: 'warning'; targetStage: Stage; missingStage: Stage }
  | { type: 'on_hold' }
  | { type: 'qc' }
  | { type: 'partial_dispatch' }
  | { type: 'full_dispatch' }
  | { type: 'close_po' };

export default function JobDetailClient({ initialJob, dept }: Props) {
  const [job,          setJob]          = useState<Job>(initialJob);
  const [modal,        setModal]        = useState<ModalState>({ type: 'none' });
  const [submitting,   setSubmitting]   = useState(false);
  const [pendingStage, setPendingStage] = useState<Stage | null>(null);
  const [pendingPayload, setPendingPayload] = useState<{
    new_status:      Stage;
    remark?:         string;
    qty_dispatched?: number;
  } | null>(null);

  const availableStages: Stage[] = [...PIPELINE_STAGES, 'On Hold'];
  if (dept === 'Admin') availableStages.push('PO Closed');
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

  // ── Status change handlers (exact same logic as JobRow) ──────

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

    // Advancing FROM Quality Check to a non-modal stage: capture an optional QC remark first
    if (job.status === 'Quality Check') {
      setModal({ type: 'qc' });
      return;
    }

    // Submit directly — the server is the source of truth for prerequisites
    // and responds 409 if the previous stage isn't complete.
    await submitStatusChange({ new_status: newStage });
  }

  async function submitStatusChange(payload: {
    new_status:             Stage;
    remark?:                string;
    qty_dispatched?:        number;
    override_prerequisite?: boolean;
    override_remark?:       string;
  }) {
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

      setJob(data.job);
      setPendingPayload(null);
      toast.success(`Status updated to "${payload.new_status}"`);
    } catch {
      toast.error('Network error. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Derived display values ───────────────────────────────────

  // Print-run jobs track quantity via total_qty_dispatched;
  // classic jobs via dispatched_qty.
  const effectiveDispatched = job.has_partial_runs
    ? (job.total_qty_dispatched ?? 0)
    : (job.dispatched_qty ?? 0);
  const dispatchPct = job.label_qty
    ? Math.round((effectiveDispatched / job.label_qty) * 100)
    : 0;

  // ── Render ───────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Back link */}
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--glass-muted)] hover:text-[var(--glass-ink)] transition-colors"
      >
        ← Back to Dashboard
      </Link>

      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-[var(--glass-ink)] font-mono tracking-tight">
            {job.po_number}
          </h1>
          {job.pm_code && (
            <p className="text-sm text-[var(--glass-muted)] font-mono mt-0.5">{job.pm_code}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {job.has_partial_runs && (
            <span className="inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full bg-purple-400/15 text-purple-200">
              Partial Runs
            </span>
          )}
          {job.urgent && (
            <span className={cn(
              'inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full',
              urgentBadgeClass(job.urgent_priority)
            )}>
              <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
              URGENT · P{job.urgent_priority}
            </span>
          )}
        </div>
      </div>

      {/* Job info card */}
      <div className="glass rounded-xl p-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-8 gap-y-5">

          <InfoField label="Party">
            <p className="text-sm font-semibold text-[var(--glass-ink)]">{job.party}</p>
          </InfoField>

          <InfoField label="Job Name">
            <p className="text-sm text-[var(--glass-ink)]">{job.job_name ?? '—'}</p>
          </InfoField>

          <InfoField label="Type">
            <span className={cn(
              'text-xs px-2 py-0.5 rounded font-medium',
              JOB_TYPE_BADGE[job.job_type]
            )}>
              {job.job_type}
            </span>
          </InfoField>

          <InfoField label="Label Qty">
            <p className="text-sm font-mono text-[var(--glass-ink)]">{formatQty(job.label_qty)}</p>
          </InfoField>

          <InfoField label="Dispatched">
            {job.label_qty ? (
              <div>
                <p className="text-sm font-mono text-[var(--glass-ink)]">
                  {formatQty(effectiveDispatched)} / {formatQty(job.label_qty)}
                </p>
                <div className="h-1.5 bg-white/10 rounded-full mt-1.5 w-24">
                  <div
                    className="h-full bg-emerald-400 rounded-full transition-all"
                    style={{ width: `${dispatchPct}%` }}
                  />
                </div>
              </div>
            ) : (
              <p className="text-sm text-[var(--glass-muted)]">—</p>
            )}
          </InfoField>

          <InfoField label="Delivery Date">
            <DeliveryDateEdit
              jobId={job.id}
              deliveryDate={job.delivery_date}
              dept={dept}
              onUpdated={(date) => setJob((j) => ({ ...j, delivery_date: date }))}
            />
          </InfoField>

          <InfoField label="PO Date">
            <p className="text-sm font-mono text-[var(--glass-ink)]">{formatShortDate(job.po_date)}</p>
          </InfoField>

          <InfoField label="Created">
            <p className="text-sm font-mono text-[var(--glass-muted)]">{formatAdminDate(job.created_at)}</p>
          </InfoField>

          <InfoField label="Status">
            <select
              value={job.status}
              disabled={submitting}
              onChange={(e) => handleStageSelect(e.target.value as Stage)}
              className={cn(
                'w-full px-2 py-1.5 rounded-lg border border-transparent text-xs font-medium',
                // Match the app-wide emerald focus bloom (see inputCls / DeliveryDateEdit)
                'focus:outline-none focus:border-emerald-300/70',
                'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)]',
                'transition-all cursor-pointer',
                STATUS_COLORS[job.status]?.bg   ?? 'bg-white/10',
                STATUS_COLORS[job.status]?.text  ?? 'text-white/80',
                '[&>option]:bg-white [&>option]:text-[var(--glass-ink)]',
                submitting && 'opacity-60 cursor-not-allowed'
              )}
            >
              {filteredStages.map((stage) => {
                const allowed   = canDeptSetStage(dept, stage);
                const completed = completedSet.has(stage);
                return (
                  <option key={stage} value={stage} disabled={!allowed}>
                    {`${allowed ? '' : '🔒 '}${completed ? '✓ ' : ''}${stage}`}
                  </option>
                );
              })}
            </select>
            {job.is_scheduled_release && (
              <p className="text-[10px] text-[var(--glass-muted)] mt-1">
                Printing onward is updated per release below
              </p>
            )}
          </InfoField>

          {job.is_scheduled_release && (
            <InfoField label="Release">
              <span className="text-xs px-2 py-0.5 rounded bg-sky-400/15 text-sky-200 font-medium">
                Scheduled
              </span>
            </InfoField>
          )}
        </div>

        {/* Notes */}
        {job.notes && (
          <div className="mt-5 pt-5 border-t border-white/10">
            <p className="text-xs font-medium text-[var(--glass-muted)] uppercase tracking-wide mb-1">Notes</p>
            <p className="text-sm text-[var(--glass-ink)]">{job.notes}</p>
          </div>
        )}

        {/* Halt remark */}
        {job.status === 'On Hold' && job.halt_remark && (
          <div className="mt-4">
            <p className="text-xs text-amber-200 bg-amber-400/10 border border-amber-300/25 rounded-lg px-3 py-2">
              ⏸ On hold: {job.halt_remark}
            </p>
          </div>
        )}

        {/* QC remark */}
        {job.qc_remark && (
          <div className="mt-4">
            <p className="text-xs text-sky-200 bg-sky-400/10 border border-sky-300/25 rounded-lg px-3 py-2">
              QC note: {job.qc_remark}
            </p>
          </div>
        )}
      </div>

      {/* Stage history + comments + dispatch schedules */}
      <div className="glass rounded-xl px-6 pb-2">
        <HistoryPanel
          jobId={job.id}
          jobType={job.job_type}
          isScheduledRelease={job.is_scheduled_release}
          dept={dept}
          refreshKey={job.updated_at}
        />
      </div>

      {/* ── Modals (same pattern as JobRow) ────────────────────── */}

      {modal.type === 'warning' && (
        <SequentialWarningModal
          targetStage={modal.targetStage}
          missingStage={modal.missingStage}
          isAdmin={dept === 'Admin'}
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

      {modal.type === 'on_hold' && (
        <OnHoldModal
          onCancel={() => setModal({ type: 'none' })}
          onConfirm={(remark) =>
            submitStatusChange({ new_status: 'On Hold', remark })
          }
        />
      )}

      {modal.type === 'qc' && (
        <QCModal
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
          remaining={job.remaining_qty ?? (job.label_qty ? job.label_qty - job.dispatched_qty : 0)}
          onCancel={() => setModal({ type: 'none' })}
          onConfirm={(qty) =>
            submitStatusChange({ new_status: 'Partial Dispatch', qty_dispatched: qty })
          }
        />
      )}

      {modal.type === 'full_dispatch' && (
        <FullDispatchModal
          remaining={job.remaining_qty ?? (job.label_qty ? job.label_qty - job.dispatched_qty : 0)}
          onCancel={() => setModal({ type: 'none' })}
          onConfirm={() =>
            submitStatusChange({ new_status: 'Dispatched' })
          }
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

// ── Small helper — keeps the info grid DRY ──────────────────────

function InfoField({
  label,
  children,
}: {
  label:    string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-[var(--glass-muted)] uppercase tracking-wide mb-1">
        {label}
      </p>
      {children}
    </div>
  );
}
