'use client';
// src/components/admin/JobRow.tsx

import { useState } from 'react';
import { cn, formatAdminDate, formatShortDate, formatQty } from '@/lib/utils';
import { STATUS_COLORS, ROW_URGENCY_STYLES } from '@/lib/constants/statusColors';
import { PIPELINE_STAGES, REPEAT_SKIPPED_STAGES } from '@/lib/constants/stages';
import { canDeptSetStage } from '@/lib/constants/departments';
import type { Job } from '@/lib/types';
import type { Department } from '@/lib/constants/departments';
import type { Stage } from '@/lib/constants/stages';
import HistoryPanel from './HistoryPanel';
import DeliveryDateEdit from './DeliveryDateEdit';
import JobDuplicateButton from './JobDuplicateButton';
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
  job:            Job;
  dept:           Department;
  isExpanded:     boolean;
  onToggleExpand: () => void;
  onJobUpdated:   (job: Job) => void;
  onJobDeleted:   (id: string) => void;
  onDuplicate:    (data: { party: string; pm_code: string; job_name: string; label_qty: number | null; job_type: 'New' | 'Repeat' | 'Artwork Changed'; notes: string }) => void;
};

type ModalState =
  | { type: 'none' }
  | { type: 'warning'; targetStage: Stage; missingStage: Stage }
  | { type: 'on_hold' }
  | { type: 'qc' }
  | { type: 'partial_dispatch' }
  | { type: 'full_dispatch' }
  | { type: 'close_po' };

export default function JobRow({
  job, dept, isExpanded, onToggleExpand, onJobUpdated, onJobDeleted, onDuplicate,
}: Props) {
  const [pendingStage,   setPendingStage]   = useState<Stage | null>(null);
  const [modal,          setModal]          = useState<ModalState>({ type: 'none' });
  const [submitting,     setSubmitting]     = useState(false);
  const [pendingPayload, setPendingPayload] = useState<{
    new_status:      Stage;
    remark?:         string;
    qty_dispatched?: number;
  } | null>(null);

  // ── Row visual class ────────────────────────────────────────
  const rowClass = cn(
    'border-b border-brand-border transition-colors',
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
          : ROW_URGENCY_STYLES.normal
  );

  // ── Dropdown change handler ─────────────────────────────────
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

  // ── Submit status change ────────────────────────────────────
  async function submitStatusChange(payload: {
    new_status:            Stage;
    remark?:               string;
    qty_dispatched?:       number;
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

  // ── Last status log display ─────────────────────────────────
  const lastUpdatedLine = job.updated_at
    ? `${formatAdminDate(job.updated_at)}`
    : '—';

  // ── Dispatch progress ───────────────────────────────────────
  // Print-run jobs track quantity via total_qty_dispatched;
  // classic jobs via dispatched_qty.
  const effectiveDispatched = job.has_partial_runs
    ? (job.total_qty_dispatched ?? 0)
    : (job.dispatched_qty ?? 0);
  const dispatchPct = job.label_qty
    ? Math.round((effectiveDispatched / job.label_qty) * 100)
    : 0;

  // ── Available stages in dropdown ────────────────────────────
  const _stages: Stage[] = [...PIPELINE_STAGES, 'On Hold'];
  if (dept === 'Admin') _stages.push('PO Closed');
  const availableStages = job.job_type === 'Repeat'
    ? _stages.filter((s) => !REPEAT_SKIPPED_STAGES.includes(s as any))
    : _stages;

  // Completed stages — shown with ✓ in the dropdown
  const completedSet = new Set(
    (job.job_stage_timestamps ?? []).map((t) => t.stage)
  );

  return (
    <>
      <tr className={rowClass}>
        {/* PO / PM */}
        <td className="px-4 py-3 min-w-[130px]">
          <p className="font-mono text-xs font-medium text-brand-accent">{job.po_number}</p>
          {job.pm_code && (
            <p className="font-mono text-xs text-brand-muted mt-0.5">{job.pm_code}</p>
          )}
          {job.urgent && (
            <span className={cn(
              'inline-flex items-center gap-1 mt-1 text-xs font-medium px-1.5 py-0.5 rounded',
              job.urgent_priority === 1 ? 'bg-red-100 text-red-700' :
              job.urgent_priority === 2 ? 'bg-orange-100 text-orange-700' :
              'bg-yellow-100 text-yellow-700'
            )}>
              <span className="dot-pulse inline-block w-1.5 h-1.5 rounded-full bg-current" />
              P{job.urgent_priority}
            </span>
          )}
        </td>

        {/* Party / Job name + notes */}
        <td className="px-4 py-3 min-w-[200px]">
          <p className="font-medium text-brand-accent text-sm truncate max-w-[220px]">{job.party}</p>
          {job.job_name && (
            <p className="text-xs text-brand-muted truncate max-w-[220px] mt-0.5">{job.job_name}</p>
          )}
          {job.has_partial_runs && (
            <span className="inline-block mt-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">
              Partial Runs
            </span>
          )}
          {job.halt_remark && job.status === 'On Hold' && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded px-1.5 py-0.5 mt-1 truncate max-w-[220px]">
              ⏸ {job.halt_remark}
            </p>
          )}
          {job.notes && (
            <p className="text-xs text-brand-muted mt-0.5 truncate max-w-[220px]">{job.notes}</p>
          )}
        </td>

        {/* Dispatch progress */}
        <td className="px-4 py-3 min-w-[120px]">
          {job.label_qty ? (
            <div>
              <p className="font-mono text-xs text-brand-accent">
                {formatQty(effectiveDispatched)} / {formatQty(job.label_qty)}
                {job.has_partial_runs && (
                  <span className="text-brand-muted"> dispatched</span>
                )}
              </p>
              <div className="h-1.5 bg-brand-bg rounded-full mt-1.5 w-20">
                <div
                  className="h-full bg-green-500 rounded-full transition-all"
                  style={{ width: `${dispatchPct}%` }}
                />
              </div>
              {job.is_scheduled_release && (
                <p className="text-xs text-blue-600 mt-1">Scheduled</p>
              )}
            </div>
          ) : (
            <span className="text-brand-muted text-xs">—</span>
          )}
        </td>

        {/* Delivery date with inline edit */}
        <td className="px-4 py-3 min-w-[120px]">
          <DeliveryDateEdit
            jobId={job.id}
            deliveryDate={job.delivery_date}
            dept={dept}
            onUpdated={(date) => onJobUpdated({ ...job, delivery_date: date })}
          />
        </td>

        {/* Job type badge */}
        <td className="px-4 py-3">
          <span className={cn(
            'text-xs px-2 py-0.5 rounded font-medium',
            job.job_type === 'New'             ? 'bg-blue-100 text-blue-700' :
            job.job_type === 'Repeat'          ? 'bg-gray-100 text-gray-600' :
            'bg-purple-100 text-purple-700'
          )}>
            {job.job_type}
          </span>
        </td>

        {/* Status dropdown */}
        <td className="px-4 py-3 min-w-[180px]">
          <select
            value={job.status}
            disabled={submitting}
            onChange={(e) => handleStageSelect(e.target.value as Stage)}
            className={cn(
              'w-full px-2 py-1.5 rounded-lg border text-xs font-medium',
              'focus:outline-none focus:ring-2 focus:ring-brand-accent/20',
              'transition-colors cursor-pointer',
              STATUS_COLORS[job.status]?.bg ?? 'bg-gray-100',
              STATUS_COLORS[job.status]?.text ?? 'text-gray-700',
              'border-transparent'
            )}
          >
            {availableStages.map((stage) => {
              const allowed   = canDeptSetStage(dept, stage);
              const completed = completedSet.has(stage);
              return (
                <option
                  key={stage}
                  value={stage}
                  disabled={!allowed}
                >
                  {`${allowed ? '' : '🔒 '}${completed ? '✓ ' : ''}${stage}`}
                </option>
              );
            })}
          </select>
        </td>

        {/* Last updated */}
        <td className="px-4 py-3 min-w-[140px]">
          <p className="text-xs text-brand-muted font-mono">{lastUpdatedLine}</p>
        </td>

        {/* Actions */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              onClick={onToggleExpand}
              className="text-brand-muted hover:text-brand-accent text-xs transition-colors px-2 py-1 rounded border border-brand-border"
            >
              {isExpanded ? '▲ Less' : '▼ More'}
            </button>

            <JobDuplicateButton job={job} onDuplicate={onDuplicate} />

            {dept === 'Admin' && (
              <button
                onClick={async () => {
                  if (!confirm(`Delete job ${job.po_number}? This cannot be undone.`)) return;
                  await fetch(`/api/jobs/${job.id}`, { method: 'DELETE' });
                  onJobDeleted(job.id);
                  toast.success('Job deleted');
                }}
                className="text-red-400 hover:text-red-600 text-xs transition-colors px-2 py-1"
              >
                Del
              </button>
            )}
          </div>
        </td>
      </tr>

      {/* Expanded history panel */}
      {isExpanded && (
        <tr>
          <td colSpan={8} className="px-4 py-0 bg-brand-bg">
            <HistoryPanel
              jobId={job.id}
              jobType={job.job_type}
              isScheduledRelease={job.is_scheduled_release}
              dept={dept}
              refreshKey={job.updated_at}
            />
          </td>
        </tr>
      )}

      {/* Modals */}
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
    </>
  );
}

// StatusBadge is imported from ./StatusBadge — no inline duplicate needed.
