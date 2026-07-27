'use client';
// src/components/admin/JobRow.tsx
// The desk view of a job (sm and up). Renders inside the jobs <table>.
// Stage-change rules, delete, and the modal set are shared with the phone
// card via useJobActions / JobActionModals — this file is layout only.

import { ChevronDown, ChevronUp, PauseCircle, Trash2 } from 'lucide-react';
import { cn, formatAdminDate, formatQty } from '@/lib/utils';
import { STATUS_COLORS, JOB_TYPE_BADGE, urgentBadgeClass } from '@/lib/constants/statusColors';
import { canDeptSetStage } from '@/lib/constants/departments';
import { useJobActions } from '@/hooks/useJobActions';
import type { Job } from '@/lib/types';
import type { Department } from '@/lib/constants/departments';
import type { Stage } from '@/lib/constants/stages';
import HistoryPanel from './HistoryPanel';
import DeliveryDateEdit from './DeliveryDateEdit';
import JobDuplicateButton from './JobDuplicateButton';
import JobActionModals from './JobActionModals';

type Props = {
  job:            Job;
  dept:           Department;
  isExpanded:     boolean;
  onToggleExpand: () => void;
  onJobUpdated:   (job: Job) => void;
  onJobDeleted:   (id: string) => void;
  onDuplicate:    (data: { party: string; pm_code: string; job_name: string; label_qty: number | null; job_type: 'New' | 'Repeat' | 'Artwork Changed'; notes: string }) => void;
};

export default function JobRow({
  job, dept, isExpanded, onToggleExpand, onJobUpdated, onJobDeleted, onDuplicate,
}: Props) {
  const actions = useJobActions({ job, dept, onJobUpdated, onJobDeleted });

  const rowClass = cn('border-b border-white/8 transition-colors', actions.urgencyTint);

  const lastUpdatedLine = job.updated_at ? formatAdminDate(job.updated_at) : '—';

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
                {formatQty(actions.effectiveDispatched)} / {formatQty(job.label_qty)}
                {job.has_partial_runs && (
                  <span className="text-[var(--glass-muted)]"> dispatched</span>
                )}
              </p>
              <div
                className="h-1.5 bg-white/10 rounded-full mt-1.5 w-20"
                role="progressbar"
                aria-valuenow={actions.dispatchPct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Dispatched ${actions.dispatchPct}% of order`}
              >
                <div
                  className="h-full bg-emerald-400 rounded-full transition-all"
                  style={{ width: `${actions.dispatchPct}%` }}
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
          <label htmlFor={`row-stage-${job.id}`} className="sr-only">
            Status for job {job.po_number}
          </label>
          <select
            id={`row-stage-${job.id}`}
            value={job.status}
            disabled={actions.submitting}
            onChange={(e) => actions.handleStageSelect(e.target.value as Stage)}
            className={cn(
              'w-full px-2 py-1.5 rounded-lg border border-transparent text-xs font-medium',
              // Match the app-wide emerald focus bloom (see inputCls / DeliveryDateEdit)
              'focus:outline-none focus:border-emerald-300/70',
              'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)]',
              'transition-all cursor-pointer',
              STATUS_COLORS[job.status]?.bg ?? 'bg-slate-100',
              STATUS_COLORS[job.status]?.text ?? 'text-slate-700',
              '[&>option]:bg-white [&>option]:text-[var(--glass-ink)]'
            )}
          >
            {actions.availableStages.map((stage) => {
              const allowed   = canDeptSetStage(dept, stage);
              const completed = actions.completedSet.has(stage);
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
                onClick={actions.openDeleteModal}
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

      {/* Modals portal to document.body, so rendering them here is tbody-safe */}
      <JobActionModals job={job} dept={dept} actions={actions} />
    </>
  );
}
