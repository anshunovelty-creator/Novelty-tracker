'use client';
// src/components/admin/JobRow.tsx
// The desk view of a job (sm and up). Renders inside the jobs <table>.
// Stage-change rules, delete, and the modal set are shared with the phone
// card via useJobActions / JobActionModals — this file is layout only.
//
// Column order is identity → work → commercial → state → time → actions:
// Job Card | PM / Job | Party / PO | Type | Dispatch | Delivery | Status |
// Updated | Actions. The job card number leads because it is what prepress
// quotes off the physical card; the job name is the largest text in the row
// because it is what the floor actually recognises a job by.

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp, PauseCircle, Pencil, Trash2, CheckCircle2 } from 'lucide-react';
import { cn, formatAdminDateParts, formatJobCardNumber, formatNumericDate, formatQty } from '@/lib/utils';
import { STATUS_COLORS, JOB_TYPE_BADGE, urgentBadgeClass } from '@/lib/constants/statusColors';
import { canDeptSetStage, canDeptEditJobDetails } from '@/lib/constants/departments';
import { useJobActions } from '@/hooks/useJobActions';
import type { Job } from '@/lib/types';
import type { DeptPermissions } from '@/lib/constants/departments';
import type { Stage } from '@/lib/constants/stages';
import HistoryPanel from './HistoryPanel';
import DeliveryDateEdit from './DeliveryDateEdit';
import EditJobModal from './EditJobModal';
import JobDuplicateButton from './JobDuplicateButton';
import JobActionModals from './JobActionModals';

/** Number of <td>s in a row — the expanded history panel has to span them all. */
export const JOB_ROW_COLS = 9;

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

/** Small neutral chip — printing unit, partial-runs marker. */
const metaChip =
  'inline-flex items-center text-[11px] font-medium px-1.5 py-0.5 rounded ' +
  'bg-black/[0.04] border border-black/[0.06] text-[var(--glass-muted)]';

/** Tertiary label ("PO DT", "PM", "PO") — quieter than muted body text. */
const microLabel = 'text-[10px] tracking-[0.06em] uppercase text-[var(--glass-muted)] opacity-70';

export default function JobRow({
  job, dept, index, isExpanded, onToggleExpand, onJobUpdated, onJobDeleted, onDuplicate,
}: Props) {
  const actions = useJobActions({ job, dept, onJobUpdated, onJobDeleted });
  const [editing, setEditing] = useState(false);

  // Urgency tint (on-hold, QC, urgent) always wins; otherwise zebra-stripe by row position.
  const rowClass = cn(
    'group border-b border-white/8 transition-colors',
    actions.urgencyTint || (index % 2 === 1 ? 'bg-[var(--glass-bg)]' : ''),
  );

  const updated  = formatAdminDateParts(job.updated_at);
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
        <td className="align-top w-[168px] p-0">
          <Link
            href={`/admin/jobs/${job.id}`}
            aria-label={`Open job ${cardNo ?? job.po_number} in detail`}
            className={cn(
              'group/open block px-4 py-4 h-full transition-colors',
              'hover:bg-black/[0.05] focus:outline-none',
              'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400/70',
            )}
          >
            {cardNo ? (
              <p className="font-mono text-[17px] font-bold leading-tight tracking-[0.02em] text-[var(--glass-ink)] underline decoration-transparent underline-offset-[3px] group-hover/open:decoration-current transition-[text-decoration-color]">
                {cardNo}
              </p>
            ) : (
              <p className="font-mono text-[13px] font-semibold text-[var(--glass-muted)] underline decoration-transparent underline-offset-[3px] group-hover/open:decoration-current transition-[text-decoration-color]">
                No card no.
              </p>
            )}

            {job.po_date && (
              <p className="font-mono text-[11px] text-[var(--glass-muted)] mt-1">
                <span className={microLabel}>PO DT</span>
                <span className="ml-1.5">{formatNumericDate(job.po_date)}</span>
              </p>
            )}

            {(job.printing_units || job.urgent) && (
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                {job.printing_units && (
                  <span className={metaChip}>{job.printing_units.name}</span>
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
            )}
          </Link>
        </td>

        {/* ── PM / Job: the largest text in the row. Wraps to two lines
             rather than truncating — a clipped label name is useless. ── */}
        <td className="px-4 py-4 align-top min-w-[280px] max-w-[420px]">
          {job.pm_code && (
            <p className="font-mono text-[11px] tracking-[0.04em] text-[var(--glass-muted)]">
              <span className={microLabel}>PM</span>
              <span className="ml-1.5">{job.pm_code}</span>
            </p>
          )}
          <p
            className="text-[15px] font-medium leading-snug text-[var(--glass-ink)] mt-0.5 line-clamp-2"
            title={job.job_name ?? undefined}
          >
            {job.job_name || <span className="text-[var(--glass-muted)]">Untitled job</span>}
          </p>

          {(job.has_partial_runs || job.notes || (job.halt_remark && job.status === 'On Hold')) && (
            <div className="mt-1.5 space-y-1">
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
        <td className="px-4 py-4 align-top w-[220px]">
          <p className="text-sm font-semibold leading-snug text-[var(--glass-ink)] line-clamp-2" title={job.party}>
            {job.party}
          </p>
          <p className="font-mono text-xs text-[var(--glass-muted)] mt-1 break-all">
            <span className={microLabel}>PO</span>
            <span className="ml-1.5">{job.po_number}</span>
          </p>
        </td>

        {/* ── Type ─────────────────────────────────────────────────── */}
        <td className="px-4 py-4 align-top w-[104px]">
          <span className={cn('text-xs px-2 py-0.5 rounded font-medium whitespace-nowrap', JOB_TYPE_BADGE[job.job_type])}>
            {job.job_type}
          </span>
        </td>

        {/* ── Dispatch progress ────────────────────────────────────── */}
        <td className="px-4 py-4 align-top w-[156px]">
          {job.label_qty ? (
            <div>
              <p className="font-mono text-[13px] text-[var(--glass-ink)]">
                <span className="font-bold">{formatQty(actions.effectiveDispatched)}</span>
                <span className="text-[var(--glass-muted)]"> / {formatQty(job.label_qty)}</span>
              </p>
              <div
                className="h-1 bg-black/[0.08] rounded-full mt-2"
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
                <p className="text-[11px] text-sky-200 mt-1">Scheduled</p>
              )}
            </div>
          ) : (
            <span className="text-[var(--glass-muted)] text-xs">—</span>
          )}
        </td>

        {/* ── Delivery date with inline edit ───────────────────────── */}
        <td className="px-4 py-4 align-top w-[140px]">
          <DeliveryDateEdit
            jobId={job.id}
            deliveryDate={job.delivery_date}
            dept={dept}
            onUpdated={(date) => onJobUpdated({ ...job, delivery_date: date })}
          />
        </td>

        {/* ── Status ───────────────────────────────────────────────── */}
        <td className="px-4 py-4 align-top w-[232px]">
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
              const allowed   = canDeptSetStage(dept, stage, job.printing_method);
              const completed = actions.completedSet.has(stage);
              return (
                <option key={stage} value={stage} disabled={!allowed}>
                  {`${allowed ? '' : '🔒 '}${completed ? '✓ ' : ''}${stage}`}
                </option>
              );
            })}
          </select>

          {job.status === 'Slitting' && job.slitting_confirmed_at && (
            <p className="flex items-center gap-1 text-[11px] text-emerald-700 font-medium mt-1.5">
              <CheckCircle2 className="w-3 h-3" aria-hidden="true" /> Ready for QC
            </p>
          )}

          {actions.canConfirmSlitting && (
            <button
              onClick={actions.confirmSlitting}
              disabled={actions.submitting}
              className={cn(
                'mt-1.5 w-full inline-flex items-center justify-center gap-1 text-[11px] font-semibold',
                'px-2 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700',
                'transition-colors disabled:opacity-60 whitespace-nowrap',
              )}
            >
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Mark Slitting Complete
            </button>
          )}
        </td>

        {/* ── Updated: date over time, so the eye scans one column. ── */}
        <td className="px-4 py-4 align-top w-[124px]">
          {updated ? (
            <div className="font-mono text-xs leading-relaxed">
              <p className="text-[var(--glass-ink)]">{updated.date}</p>
              <p className="text-[var(--glass-muted)]">{updated.time}</p>
            </div>
          ) : (
            <span className="text-[var(--glass-muted)] text-xs">—</span>
          )}
        </td>

        {/* ── Actions ──────────────────────────────────────────────── */}
        <td className="px-4 py-4 align-top w-[200px]">
          <div className="flex items-center justify-end gap-1.5">
            <button
              onClick={onToggleExpand}
              aria-expanded={isExpanded}
              aria-label={isExpanded ? 'Hide job history' : 'Show job history'}
              className={cn(
                'inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md',
                'bg-white border border-white/15 text-[var(--glass-ink)]',
                'hover:bg-black/[0.04] transition-colors whitespace-nowrap',
              )}
            >
              {isExpanded
                ? <><ChevronUp className="w-3.5 h-3.5" aria-hidden="true" /> Less</>
                : <><ChevronDown className="w-3.5 h-3.5" aria-hidden="true" /> More</>}
            </button>

            {canDeptEditJobDetails(dept) && (
              <button
                onClick={() => setEditing(true)}
                aria-label={`Edit job ${cardNo ?? job.po_number}`}
                title="Edit job details"
                className={cn(
                  'inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md',
                  'bg-white border border-white/15 text-[var(--glass-ink)]',
                  'hover:bg-black/[0.04] transition-colors whitespace-nowrap',
                )}
              >
                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                Edit
              </button>
            )}

            <JobDuplicateButton job={job} onDuplicate={onDuplicate} />

            {dept.isSuperAdmin && (
              <button
                onClick={actions.openDeleteModal}
                aria-label={`Delete job ${cardNo ?? job.po_number}`}
                title="Delete job"
                className={cn(
                  'inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md',
                  'border border-transparent text-red-300 hover:bg-red-400/15 transition-colors',
                )}
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                Del
              </button>
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
