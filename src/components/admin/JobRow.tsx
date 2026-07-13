'use client';
// src/components/admin/JobRow.tsx

import { useState } from 'react';
import { ChevronDown, ChevronUp, PauseCircle, Trash2 } from 'lucide-react';
import { cn, formatAdminDate, formatShortDate, formatQty } from '@/lib/utils';
import { STATUS_COLORS, ROW_URGENCY_STYLES, JOB_TYPE_BADGE, urgentBadgeClass } from '@/lib/constants/statusColors';
import { PIPELINE_STAGES, REPEAT_SKIPPED_STAGES, isPerReleaseStage } from '@/lib/constants/stages';
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
  ConfirmModal,
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
  | { type: 'close_po' }
  | { type: 'delete' };

export default function JobRow({
  job, dept, isExpanded, onToggleExpand, onJobUpdated, onJobDeleted, onDuplicate,
}: Props) {
  const [pendingStage,   setPendingStage]   = useState<Stage | null>(null);
  const [modal,          setModal]          = useState<ModalState>({ type: 'none' });
  const [submitting,     setSubmitting]     = useState(false);
  const [deleting,       setDeleting]       = useState(false);
  const [pendingPayload, setPendingPayload] = useState<{
    new_status:      Stage;
    remark?:         string;
    qty_dispatched?: number;
  } | null>(null);

  // ── Row visual class ────────────────────────────────────────
  const rowClass = cn(
    'border-b border-white/8 transition-colors',
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
  let availableStages = job.job_type === 'Repeat'
    ? _stages.filter((s) => !REPEAT_SKIPPED_STAGES.includes(s as any))
    : _stages;
  // Scheduled-release jobs: printing onward is advanced per release in the
  // job's Releases panel — only the once-per-job stages stay in this dropdown.
  if (job.is_scheduled_release) {
    availableStages = availableStages.filter((s) => !isPerReleaseStage(s));
  }

  // Completed stages — shown with ✓ in the dropdown
  const completedSet = new Set(
    (job.job_stage_timestamps ?? []).map((t) => t.stage)
  );

  return (
    <>
      <tr className={rowClass}>
        {/* PO / PM */}
        <td className="px-4 py-3 min-w-[130px]">
          <p className="font-mono text-xs font-medium text-[var(--glass-ink)]">{job.po_number}</p>
          {job.pm_code && (
            <p className="font-mono text-xs text-[var(--glass-muted)] mt-0.5">{job.pm_code}</p>
          )}
          {job.urgent && (
            <span className={cn(
              'inline-flex items-center gap-1 mt-1 text-xs font-medium px-1.5 py-0.5 rounded',
              urgentBadgeClass(job.urgent_priority)
            )}>
              <span className="dot-pulse inline-block w-1.5 h-1.5 rounded-full bg-current" />
              P{job.urgent_priority}
            </span>
          )}
        </td>

        {/* Party / Job name + notes */}
        <td className="px-4 py-3 min-w-[200px]">
          <p className="font-medium text-[var(--glass-ink)] text-sm truncate max-w-[220px]">{job.party}</p>
          {job.job_name && (
            <p className="text-xs text-[var(--glass-muted)] truncate max-w-[220px] mt-0.5">{job.job_name}</p>
          )}
          {job.has_partial_runs && (
            <span className="inline-block mt-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-purple-400/15 text-purple-200">
              Partial Runs
            </span>
          )}
          {job.halt_remark && job.status === 'On Hold' && (
            <p className="inline-flex items-center gap-1 text-xs text-amber-200 bg-amber-400/10 rounded px-1.5 py-0.5 mt-1 max-w-[220px]">
              <PauseCircle className="w-3 h-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{job.halt_remark}</span>
            </p>
          )}
          {job.notes && (
            <p className="text-xs text-[var(--glass-muted)] mt-0.5 truncate max-w-[220px]">{job.notes}</p>
          )}
        </td>

        {/* Dispatch progress */}
        <td className="px-4 py-3 min-w-[120px]">
          {job.label_qty ? (
            <div>
              <p className="font-mono text-xs text-[var(--glass-ink)]">
                {formatQty(effectiveDispatched)} / {formatQty(job.label_qty)}
                {job.has_partial_runs && (
                  <span className="text-[var(--glass-muted)]"> dispatched</span>
                )}
              </p>
              <div
                className="h-1.5 bg-white/10 rounded-full mt-1.5 w-20"
                role="progressbar"
                aria-valuenow={dispatchPct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Dispatched ${dispatchPct}% of order`}
              >
                <div
                  className="h-full bg-emerald-400 rounded-full transition-all"
                  style={{ width: `${dispatchPct}%` }}
                />
              </div>
              {job.is_scheduled_release && (
                <p className="text-xs text-sky-200 mt-1">Scheduled</p>
              )}
            </div>
          ) : (
            <span className="text-[var(--glass-muted)] text-xs">—</span>
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
            JOB_TYPE_BADGE[job.job_type]
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
              'w-full px-2 py-1.5 rounded-lg border border-transparent text-xs font-medium',
              // Match the app-wide emerald focus bloom (see inputCls / DeliveryDateEdit)
              'focus:outline-none focus:border-emerald-300/70',
              'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)]',
              'transition-all cursor-pointer',
              STATUS_COLORS[job.status]?.bg ?? 'bg-white/10',
              STATUS_COLORS[job.status]?.text ?? 'text-white/80',
              '[&>option]:bg-white [&>option]:text-[var(--glass-ink)]'
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
          <p className="text-xs text-[var(--glass-muted)] font-mono">{lastUpdatedLine}</p>
        </td>

        {/* Actions */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              onClick={onToggleExpand}
              aria-expanded={isExpanded}
              aria-label={isExpanded ? 'Hide job history' : 'Show job history'}
              className="inline-flex items-center gap-1 text-[var(--glass-muted)] hover:text-[var(--glass-ink)] text-xs transition-colors px-2 py-1 rounded border border-white/15 hover:bg-white/10"
            >
              {isExpanded
                ? <><ChevronUp className="w-3 h-3" aria-hidden="true" /> Less</>
                : <><ChevronDown className="w-3 h-3" aria-hidden="true" /> More</>}
            </button>

            <JobDuplicateButton job={job} onDuplicate={onDuplicate} />

            {dept === 'Admin' && (
              <button
                onClick={() => setModal({ type: 'delete' })}
                aria-label={`Delete job ${job.po_number}`}
                title="Delete job"
                className="inline-flex items-center gap-1 text-red-300 hover:text-red-200 text-xs transition-colors px-2 py-1 rounded hover:bg-red-400/15"
              >
                <Trash2 className="w-3 h-3" aria-hidden="true" />
                Del
              </button>
            )}
          </div>
        </td>
      </tr>

      {/* Expanded history panel */}
      {isExpanded && (
        <tr>
          <td colSpan={8} className="px-4 py-0 bg-black/15">
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

      {modal.type === 'delete' && (
        <ConfirmModal
          title={`Delete job ${job.po_number}?`}
          message="This permanently removes the job and its history. This cannot be undone."
          confirmLabel="Delete job"
          tone="danger"
          busy={deleting}
          onCancel={() => setModal({ type: 'none' })}
          onConfirm={handleDelete}
        />
      )}
    </>
  );
}

// StatusBadge is imported from ./StatusBadge — no inline duplicate needed.
