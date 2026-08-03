'use client';
// src/components/admin/JobCard.tsx
// The phone view of a job (below `sm`). The table it replaces put the Status
// control ~700px to the right of a 375px screen; here the stage picker is a
// full-width control at the bottom of the card, reachable with a thumb.
//
// Same data, same rules (see useJobActions) — different priority order:
// identity first, then the one decision that matters (what stage is it in),
// then delivery pressure, then everything else.

import React, { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp, PauseCircle, Pencil, Trash2 } from 'lucide-react';
import { cn, formatAdminDate, formatJobCardNumber, formatQty, getDeliveryCountdown } from '@/lib/utils';
import { STATUS_COLORS, JOB_TYPE_BADGE, urgentBadgeClass } from '@/lib/constants/statusColors';
import { canDeptSetStage, canDeptEditJobDetails } from '@/lib/constants/departments';
import { useJobActions } from '@/hooks/useJobActions';
import type { Job } from '@/lib/types';
import type { Department } from '@/lib/constants/departments';
import type { Stage } from '@/lib/constants/stages';
import HistoryPanel from './HistoryPanel';
import DeliveryDateEdit from './DeliveryDateEdit';
import EditJobModal from './EditJobModal';
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

// Delivery pressure reads as color + words, never color alone.
const COUNTDOWN_TEXT: Record<'green' | 'amber' | 'red' | 'muted', string> = {
  green: 'text-emerald-700',
  amber: 'text-amber-800',
  red:   'text-red-700 font-semibold',
  muted: 'text-[var(--glass-muted)]',
};

// 44px minimum tap target (PRODUCT.md) for every control on this surface.
const cardBtn =
  'inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-lg ' +
  'text-xs font-medium border transition-colors';

export default function JobCard({
  job, dept, isExpanded, onToggleExpand, onJobUpdated, onJobDeleted, onDuplicate,
}: Props) {
  const actions   = useJobActions({ job, dept, onJobUpdated, onJobDeleted });
  const countdown = getDeliveryCountdown(job.delivery_date);
  const [editing, setEditing] = useState(false);
  const statusColor = STATUS_COLORS[job.status];

  return (
    <article
      className={cn(
        'rounded-xl border border-black/[0.08] shadow-sm overflow-hidden',
        actions.urgencyTint || 'bg-white',
      )}
      aria-label={`Job ${job.po_number}, ${job.party}, status ${job.status}`}
    >
      {/* ── Identity ─────────────────────────────────────────── */}
      <div className="px-4 pt-3.5 pb-3">
        <div className="flex items-start justify-between gap-3">
          {/* The identity block is the way into job detail, mirroring the
              first column of the desk row. Everything interactive on this
              card sits below it, so the whole block is the tap target —
              and at this size it comfortably clears 44px. */}
          <Link
            href={`/admin/jobs/${job.id}`}
            aria-label={`Open job ${formatJobCardNumber(job.job_card_number) ?? job.po_number} in detail`}
            className={cn(
              'min-w-0 block -mx-2 -my-1 px-2 py-1 rounded-lg transition-colors',
              'hover:bg-black/[0.04] active:bg-black/[0.06]',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70',
            )}
          >
            {/* Job card number leads — it is what prepress quotes off the card. */}
            {job.job_card_number && (
              <p className="font-mono text-[11px] font-semibold text-[var(--glass-ink)] tracking-wide">
                {formatJobCardNumber(job.job_card_number)}
              </p>
            )}
            <p className="font-mono text-[11px] text-[var(--glass-muted)] tracking-wide">
              {job.po_number}
              {job.pm_code && <span className="ml-1.5">· {job.pm_code}</span>}
              {/* Printing unit — which press is taking this job. */}
              {job.printing_units && (
                <span className="ml-1.5">· {job.printing_units.name}</span>
              )}
            </p>
            <h3 className="font-semibold text-[15px] leading-snug text-[var(--glass-ink)] mt-0.5 break-words underline decoration-transparent underline-offset-[3px] hover:decoration-current transition-[text-decoration-color]">
              {job.party}
            </h3>
            {job.job_name && (
              <p className="text-xs text-[var(--glass-muted)] mt-0.5 break-words">{job.job_name}</p>
            )}
          </Link>

          <div className="shrink-0 flex flex-col items-end gap-1.5">
            {job.urgent && (
              <span className={cn(
                'inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded',
                urgentBadgeClass(job.urgent_priority),
              )}>
                <span className="dot-pulse inline-block w-1.5 h-1.5 rounded-full bg-current" />
                P{job.urgent_priority}
              </span>
            )}
            <span className={cn('text-[11px] px-2 py-0.5 rounded font-medium', JOB_TYPE_BADGE[job.job_type])}>
              {job.job_type}
            </span>
          </div>
        </div>

        {/* Flags that change what an operator should do next */}
        {(job.has_partial_runs || job.is_scheduled_release) && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {job.has_partial_runs && (
              <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 border border-purple-200">
                Partial Runs
              </span>
            )}
            {job.is_scheduled_release && (
              <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 border border-sky-200">
                Scheduled Release
              </span>
            )}
          </div>
        )}

        {job.halt_remark && job.status === 'On Hold' && (
          <p className="flex items-start gap-1.5 text-xs text-amber-900 bg-amber-100 border border-amber-200 rounded-lg px-2 py-1.5 mt-2">
            <PauseCircle className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
            <span className="break-words">{job.halt_remark}</span>
          </p>
        )}

        {job.notes && (
          <p className="text-xs text-[var(--glass-muted)] mt-2 break-words">{job.notes}</p>
        )}
      </div>

      {/* ── Delivery pressure + dispatch progress ────────────── */}
      <div className="px-4 pb-3 space-y-2 border-t border-black/[0.06] pt-3">
        <div className="flex items-center justify-between gap-3">
          <span className={cn('text-xs', COUNTDOWN_TEXT[countdown.color])}>
            {countdown.label}
          </span>
          <DeliveryDateEdit
            jobId={job.id}
            deliveryDate={job.delivery_date}
            dept={dept}
            onUpdated={(date) => onJobUpdated({ ...job, delivery_date: date })}
          />
        </div>

        {job.label_qty ? (
          <div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-[var(--glass-ink)]">
                {formatQty(actions.effectiveDispatched)} / {formatQty(job.label_qty)}
              </span>
              <span className="font-mono text-[11px] text-[var(--glass-muted)]">
                {actions.dispatchPct}% dispatched
              </span>
            </div>
            <div
              className="h-1.5 bg-black/[0.08] rounded-full mt-1.5"
              role="progressbar"
              aria-valuenow={actions.dispatchPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Dispatched ${actions.dispatchPct}% of order`}
            >
              <div
                className="h-full bg-emerald-500 rounded-full transition-all"
                style={{ width: `${actions.dispatchPct}%` }}
              />
            </div>
          </div>
        ) : null}
      </div>

      {/* ── The action: change stage ─────────────────────────── */}
      <div className="px-4 pb-3">
        <label htmlFor={`stage-${job.id}`} className="sr-only">
          Status for job {job.po_number}
        </label>
        <select
          id={`stage-${job.id}`}
          value={job.status}
          disabled={actions.submitting}
          onChange={(e) => actions.handleStageSelect(e.target.value as Stage)}
          className={cn(
            'w-full min-h-[48px] px-3 rounded-xl text-sm font-semibold cursor-pointer',
            'appearance-none text-center transition-all disabled:opacity-60',
            'focus:outline-none focus:border-emerald-400',
            'focus:shadow-[0_0_0_4px_rgba(16,85,63,0.20)]',
            statusColor?.bg ?? 'bg-slate-100',
            statusColor?.text ?? 'text-slate-700',
            statusColor?.border ?? 'border border-slate-200',
            '[&>option]:bg-white [&>option]:text-[var(--glass-ink)] [&>option]:font-normal',
          )}
        >
          {actions.availableStages.map((stage) => {
            const allowed   = canDeptSetStage(dept, stage);
            const completed = actions.completedSet.has(stage);
            return (
              <option key={stage} value={stage} disabled={!allowed}>
                {`${allowed ? '' : '🔒 '}${completed ? '✓ ' : ''}${stage}`}
              </option>
            );
          })}
        </select>
        <p className="text-[11px] text-[var(--glass-muted)] text-center mt-1.5 font-mono">
          {actions.submitting
            ? 'Saving…'
            : `Updated ${job.updated_at ? formatAdminDate(job.updated_at) : '—'}`}
        </p>
      </div>

      {/* ── Secondary actions ────────────────────────────────── */}
      <div className="flex items-stretch gap-2 px-4 pb-3.5">
        <button
          onClick={onToggleExpand}
          aria-expanded={isExpanded}
          aria-controls={`history-${job.id}`}
          className={cn(
            cardBtn, 'flex-1 border-black/10 text-[var(--glass-ink)]',
            'hover:bg-black/[0.04] active:bg-black/[0.07]',
          )}
        >
          {isExpanded
            ? <><ChevronUp className="w-3.5 h-3.5" aria-hidden="true" /> Hide history</>
            : <><ChevronDown className="w-3.5 h-3.5" aria-hidden="true" /> History</>}
        </button>

        {canDeptEditJobDetails(dept) && (
          <button
            onClick={() => setEditing(true)}
            aria-label={`Edit job ${job.po_number}`}
            title="Edit job details"
            className={cn(
              cardBtn, 'border-black/10 text-[var(--glass-ink)]',
              'hover:bg-black/[0.04] active:bg-black/[0.07]',
            )}
          >
            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
            Edit
          </button>
        )}

        <JobDuplicateButton job={job} onDuplicate={onDuplicate} size="touch" />

        {dept === 'Admin' && (
          <button
            onClick={actions.openDeleteModal}
            aria-label={`Delete job ${job.po_number}`}
            title="Delete job"
            className={cn(
              cardBtn, 'border-red-200 text-red-700 bg-red-50/60',
              'hover:bg-red-100 active:bg-red-100',
            )}
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="sr-only">Delete</span>
          </button>
        )}
      </div>

      {/* ── Expanded history ─────────────────────────────────── */}
      {isExpanded && (
        <div id={`history-${job.id}`} className="border-t border-black/[0.06] bg-black/[0.02] px-4">
          <HistoryPanel
            jobId={job.id}
            jobType={job.job_type}
            isScheduledRelease={job.is_scheduled_release}
            dept={dept}
            refreshKey={job.updated_at}
          />
        </div>
      )}

      <JobActionModals job={job} dept={dept} actions={actions} />

      {editing && (
        <EditJobModal
          job={job}
          dept={dept}
          onClose={() => setEditing(false)}
          onSaved={onJobUpdated}
        />
      )}
    </article>
  );
}
