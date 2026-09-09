'use client';
// src/components/admin/JobRow.tsx
// The desk view of a job (sm and up). Renders inside the jobs <table>.
// Stage-change rules, delete, and the modal set are shared with the phone
// card via useJobActions / JobActionModals — this file is layout only.
//
// Column order is identity → work → commercial → state → actions:
// Job Card | PM / Job | Party / PO | Dispatch | Delivery | Status | Actions.
// The job card number leads because it is what prepress quotes off the
// physical card; the job name is the largest text in the row because it is
// what the floor actually recognises a job by. "Updated" was dropped — the
// full stage-by-stage timestamp trail lives one click away in the expanded
// history panel (see HistoryPanel), so a last-touched date here was
// redundant. "Type" (New/Repeat/Artwork Changed) moved into the Job Card
// cell's chip row, alongside the printing-unit and urgent chips — it's a
// small fact about the job's identity, not a separate dimension worth a
// whole column.

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp, PauseCircle, Pencil, Trash2, CheckCircle2 } from 'lucide-react';
import { cn, formatJobCardNumber, formatNumericDate, formatQty } from '@/lib/utils';
import { STATUS_COLORS, JOB_TYPE_BADGE, urgentBadgeClass, unitDigit, unitCircleClass } from '@/lib/constants/statusColors';
import { canDeptSetStage, canDeptEditJobDetails } from '@/lib/constants/departments';
import { useJobActions } from '@/hooks/useJobActions';
import type { Job } from '@/lib/types';
import type { DeptPermissions } from '@/lib/constants/departments';
import type { Stage } from '@/lib/constants/stages';
import HistoryPanel from './HistoryPanel';
import DeliveryDateEdit from './DeliveryDateEdit';
import EditJobModal from './EditJobModal';
import JobDuplicateButton from './JobDuplicateButton';
import { Button } from '@/components/ui/Button';
import JobActionModals from './JobActionModals';

/** Number of <td>s in a row — the expanded history panel has to span them all. */
export const JOB_ROW_COLS = 7;

type Props = {
  job:            Job;
  dept:           DeptPermissions;
  index:          number;
  isExpanded:     boolean;
  onToggleExpand: () => void;
  onJobUpdated:   (job: Job) => void;
  onJobDeleted:   (id: string) => void;
  onDuplicate:    (data: { party: string; pm_code: string; job_name: string; label_qty: number | null; job_type: 'New' | 'Repeat' | 'Artwork Changed'; notes: string }) => void;
};

export default function JobRow({
  job, dept, index, isExpanded, onToggleExpand, onJobUpdated, onJobDeleted, onDuplicate,
}: Props) {
  const actions = useJobActions({ job, dept, onJobUpdated, onJobDeleted });
  const [editing, setEditing] = useState(false);

  // Urgency tint (on-hold, QC, urgent) always wins; otherwise zebra-stripe by row position.
  // The hover band is an inset box-shadow rather than a background so it layers
  // *over* the urgency tint instead of replacing it — an on-hold row must still
  // read as on-hold while the cursor is on it. Nine columns across 1400px is
  // more than the eye tracks unaided; this is what carries it from Job Card to
  // Actions without losing the row.
  const rowClass = cn(
    'group border-b border-white/8 transition-colors',
    'hover:shadow-[inset_0_0_0_9999px_rgba(12,42,32,0.065)]',
    actions.urgencyTint || (index % 2 === 1 ? 'bg-[var(--glass-bg)]' : ''),
  );

  const cardNo   = formatJobCardNumber(job.job_card_number);

  return (
    <>
      <tr className={rowClass}>
        {/* ── Job Card: the number on the physical card, its PO date, and
             the two facts that change how the row is handled.
             This cell is the row's way into job detail. It leads the row
             and holds nothing interactive, so the whole cell is the target
             — the rest of the row is full of its own controls (status
             select, inline delivery edit, action buttons) and a row-level
             click would fight every one of them. ──────────────────────── */}
        {/* Pinned left so the row keeps its identity while the other eight
             columns scroll past. Needs an opaque background of its own —
             a transparent sticky cell lets the scrolling columns show
             through underneath it. */}
        <td className="align-top min-w-[150px] p-0 sticky left-0 z-[1] bg-[#FDFEFD] group-hover:bg-[#F3F7F4] border-r border-white/12">
          <Link
            href={`/admin/jobs/${job.id}`}
            aria-label={`Open job ${cardNo ?? job.po_number} in detail`}
            className={cn(
              'group/open block px-3 py-2 h-full transition-colors',
              'hover:bg-black/[0.05] focus:outline-none',
              'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400/70',
            )}
          >
            {cardNo ? (
              <p className="font-mono text-[15px] font-bold leading-tight tracking-[0.02em] text-[var(--glass-ink)] underline decoration-transparent underline-offset-[3px] group-hover/open:decoration-current transition-[text-decoration-color]">
                {cardNo}
              </p>
            ) : (
              <p className="font-mono text-[13px] font-semibold text-[var(--glass-muted)] underline decoration-transparent underline-offset-[3px] group-hover/open:decoration-current transition-[text-decoration-color]">
                No card no.
              </p>
            )}

            {job.po_date && (
              <p className="font-mono text-[11px] text-[var(--glass-muted)] mt-0.5">
                {formatNumericDate(job.po_date)}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              <span className={cn('text-[11px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap', JOB_TYPE_BADGE[job.job_type])}>
                {job.job_type}
              </span>
              {job.printing_units && (
                <span
                  className={cn(
                    'inline-flex items-center justify-center w-5 h-5 shrink-0 rounded-full',
                    'text-[11px] font-bold text-white',
                    unitCircleClass(job.printing_units.name),
                  )}
                  title={job.printing_units.name}
                  aria-label={`Printing unit ${job.printing_units.name}`}
                >
                  {unitDigit(job.printing_units.name)}
                </span>
              )}
              {job.urgent && (
                <span className={cn(
                  'inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded',
                  urgentBadgeClass(job.urgent_priority),
                )}>
                  <span className="dot-pulse inline-block w-1.5 h-1.5 rounded-full bg-current" />
                  P{job.urgent_priority}
                </span>
              )}
            </div>
          </Link>
        </td>

        {/* ── PM / Job: the largest text in the row. Wraps to two lines
             rather than truncating — a clipped label name is useless. ── */}
        <td className="px-3 py-2 align-top min-w-[180px] border-r border-white/8">
          {job.pm_code && (
            <p className="font-mono text-[11px] tracking-[0.04em] text-[var(--glass-muted)]">
              {job.pm_code}
            </p>
          )}
          <p
            className="text-sm font-medium leading-snug text-[var(--glass-ink)] mt-0.5 line-clamp-2"
            title={job.job_name ?? undefined}
          >
            {job.job_name || <span className="text-[var(--glass-muted)]">Untitled job</span>}
          </p>

          {(job.has_partial_runs || job.notes || (job.halt_remark && job.status === 'On Hold')) && (
            <div className="mt-1 space-y-1">
              {job.has_partial_runs && (
                <span className="inline-block text-[11px] font-medium px-1.5 py-0.5 rounded bg-purple-400/15 text-purple-200">
                  Partial Runs
                </span>
              )}
              {job.halt_remark && job.status === 'On Hold' && (
                <p className="flex items-start gap-1 text-xs text-amber-200 bg-amber-400/10 rounded px-1.5 py-0.5">
                  <PauseCircle className="w-3 h-3 shrink-0 mt-0.5" aria-hidden="true" />
                  <span className="line-clamp-1">{job.halt_remark}</span>
                </p>
              )}
              {job.notes && (
                <p className="text-xs text-[var(--glass-muted)] line-clamp-1" title={job.notes}>
                  {job.notes}
                </p>
              )}
            </div>
          )}
        </td>

        {/* ── Party / PO: who it is for, and the paper it came in on. ── */}
        <td className="px-3 py-2 align-top min-w-[130px] border-r border-white/8">
          <p className="text-sm font-semibold leading-snug text-[var(--glass-ink)] line-clamp-2" title={job.party}>
            {job.party}
          </p>
          <p className="font-mono text-xs text-[var(--glass-muted)] mt-0.5 break-all">
            {job.po_number}
          </p>
        </td>

        {/* ── Dispatch progress ────────────────────────────────────── */}
        <td className="px-3 py-2 align-top min-w-[110px] border-r border-white/8">
          {job.label_qty ? (
            <div>
              <p className="font-mono text-[13px] text-[var(--glass-ink)]">
                <span className="font-bold">{formatQty(actions.effectiveDispatched)}</span>
                <span className="text-[var(--glass-muted)]"> / {formatQty(job.label_qty)}</span>
              </p>
              <div
                className="h-1 bg-black/[0.08] rounded-full mt-1.5"
                role="progressbar"
                aria-valuenow={actions.dispatchPct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Dispatched ${actions.dispatchPct}% of order`}
              >
                <div
                  className="h-full bg-emerald-600 rounded-full transition-all"
                  style={{ width: `${actions.dispatchPct}%` }}
                />
              </div>
              {job.is_scheduled_release && (
                <p className="text-[11px] text-sky-200 mt-0.5">Scheduled</p>
              )}
            </div>
          ) : (
            <span className="text-[var(--glass-muted)] text-xs">—</span>
          )}
        </td>

        {/* ── Delivery date with inline edit ───────────────────────── */}
        <td className="px-3 py-2 align-top min-w-[110px] border-r border-white/8">
          <DeliveryDateEdit
            jobId={job.id}
            deliveryDate={job.delivery_date}
            dept={dept}
            onUpdated={(date) => onJobUpdated({ ...job, delivery_date: date })}
          />
        </td>

        {/* ── Status ───────────────────────────────────────────────── */}
        <td className="px-3 py-2 align-top min-w-[150px] border-r border-white/8">
          <label htmlFor={`row-stage-${job.id}`} className="sr-only">
            Status for job {cardNo ?? job.po_number}
          </label>
          <select
            id={`row-stage-${job.id}`}
            value={job.status}
            disabled={actions.submitting}
            onChange={(e) => actions.handleStageSelect(e.target.value as Stage)}
            className={cn(
              'w-full px-2.5 py-1.5 rounded-lg text-xs font-medium',
              'focus:outline-none focus:border-emerald-300/70',
              'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)]',
              'transition-all cursor-pointer disabled:opacity-60',
              STATUS_COLORS[job.status]?.bg ?? 'bg-slate-100',
              STATUS_COLORS[job.status]?.text ?? 'text-slate-700',
              STATUS_COLORS[job.status]?.border ?? 'border border-slate-200',
              '[&>option]:bg-white [&>option]:text-[var(--glass-ink)]',
            )}
          >
            {actions.availableStages.map((stage) => {
              // Backward picks are Admin-only, and shown greyed for everyone
              // else so the pipeline reads as the one-way ratchet it is.
              const backward  = actions.isBackwardStage(stage);
              const allowed   = canDeptSetStage(dept, stage, job.printing_method)
                                && (!backward || dept.isSuperAdmin);
              const completed = actions.completedSet.has(stage);
              return (
                <option key={stage} value={stage} disabled={!allowed}>
                  {`${allowed ? '' : '🔒 '}${completed ? '✓ ' : ''}${stage}`}
                </option>
              );
            })}
          </select>

          {job.status === 'Slitting' && job.slitting_confirmed_at && (
            <p className="flex items-center gap-1 text-[11px] text-emerald-700 font-medium mt-1">
              <CheckCircle2 className="w-3 h-3" aria-hidden="true" /> Ready for QC
            </p>
          )}

          {actions.canConfirmSlitting && (
            <button
              onClick={actions.confirmSlitting}
              disabled={actions.submitting}
              className={cn(
                'mt-1 w-full inline-flex items-center justify-center gap-1 text-[11px] font-semibold',
                'px-2 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700',
                'transition-colors disabled:opacity-60 whitespace-nowrap',
              )}
            >
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Mark Slitting Complete
            </button>
          )}
        </td>

        {/* ── Actions: icon-only — the desk has a mouse, so hover/title
             tooltips carry the label instead of spelling it out in the row.
             w-8 px-0 makes each one a small square rather than a
             text-shaped button with nothing but an icon rattling in it. ── */}
        <td className="px-3 py-2 align-top min-w-[168px]">
          <div className="flex items-center justify-end gap-1">
            <Button
              size="sm"
              icon={isExpanded ? ChevronUp : ChevronDown}
              onClick={onToggleExpand}
              aria-expanded={isExpanded}
              aria-label={isExpanded ? 'Hide job history' : 'Show job history'}
              title={isExpanded ? 'Hide job history' : 'Show job history'}
              className="w-8 min-w-8 px-0"
            />

            {canDeptEditJobDetails(dept) && (
              <Button
                size="sm"
                icon={Pencil}
                onClick={() => setEditing(true)}
                aria-label={`Edit job ${cardNo ?? job.po_number}`}
                title="Edit job details"
                className="w-8 min-w-8 px-0"
              />
            )}

            <JobDuplicateButton job={job} onDuplicate={onDuplicate} />

            {dept.isSuperAdmin && (
              <Button
                size="sm"
                intent="danger"
                icon={Trash2}
                onClick={actions.openDeleteModal}
                aria-label={`Delete job ${cardNo ?? job.po_number}`}
                title="Delete job"
                className="w-8 min-w-8 px-0"
              />
            )}
          </div>
        </td>
      </tr>

      {/* Expanded history panel */}
      {isExpanded && (
        <tr>
          <td colSpan={JOB_ROW_COLS} className="px-4 py-0 bg-black/[0.03]">
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

      {editing && (
        <EditJobModal
          job={job}
          dept={dept}
          onClose={() => setEditing(false)}
          onSaved={onJobUpdated}
        />
      )}
    </>
  );
}
