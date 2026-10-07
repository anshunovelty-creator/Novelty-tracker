'use client';
// src/components/admin/JobRow.tsx
// The desk view of a job (lg and up). Renders inside the jobs <table>.
// Stage-change rules, delete, and the modal set are shared with the phone
// card via useJobActions / JobActionModals — this file is layout only.
//
// Columns follow Job Separation's worksheet so the two lists read alike:
// Sr No | Party | PO No / Date | PM Code / Material | Qty / Rate | Unit |
// Stage | Delivery Date | Actions. Sr No is the job card number; rate and
// material come from the Job Separation line the job was made from (blank
// for a job added directly). State lives in the stage control and the delivery line — rows
// are never tinted: zebra and hover are the only fills (DESIGN.md).

import dynamic from 'next/dynamic';
import { memo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp, PauseCircle, Pencil, Trash2, CheckCircle2 } from 'lucide-react';
import { cn, formatJobCardNumber, formatNumericDate, formatQty } from '@/lib/utils';
import { deliveryWords, separationOf } from '@/lib/jobViews';
import { JOB_TYPE_BADGE, unitDigit, unitCircleClass } from '@/lib/constants/statusColors';
import { canDeptEditJobDetails } from '@/lib/constants/departments';
import { useJobActions } from '@/hooks/useJobActions';
import type { Job } from '@/lib/types';
import type { DeptPermissions } from '@/lib/constants/departments';
import HistoryPanel from './HistoryPanel';
import DeliveryDateEdit from './DeliveryDateEdit';
import JobDuplicateButton from './JobDuplicateButton';
import { Button } from '@/components/ui/Button';
import JobActionModals from './JobActionModals';
import StageSelect from './StageSelect';

// Loaded on first open, not with the page — it only renders when open.
const EditJobModal = dynamic(() => import('./EditJobModal'), { ssr: false });

/** Number of <td>s in a row — the expanded history panel has to span them all. */
export const JOB_ROW_COLS = 9;

// Rate carries paise; same format as Job Separation's Qty / Rate cell.
function formatRate(value: number | null): string | null {
  return value === null ? null : value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

type Props = {
  job:            Job;
  dept:           DeptPermissions;
  index:          number;
  /** Today in IST ('YYYY-MM-DD'), from the table — one clock for every row. */
  today:          string;
  isExpanded:     boolean;
  onToggleExpand: (jobId: string) => void;
  onJobUpdated:   (job: Job) => void;
  onJobDeleted:   (id: string) => void;
  onDuplicate:    (data: { party: string; pm_code: string; job_name: string; label_qty: number | null; job_type: 'New' | 'Repeat' | 'Artwork Changed'; notes: string }) => void;
};

function JobRow({
  job, dept, index, today, isExpanded, onToggleExpand, onJobUpdated, onJobDeleted, onDuplicate,
}: Props) {
  const actions = useJobActions({ job, dept, onJobUpdated, onJobDeleted });
  const [editing, setEditing] = useState(false);

  // Zebra and hover only. The sticky Job cell inherits the row's fill so the
  // columns scrolling under it never show through.
  const rowClass = cn(
    'group transition-colors',
    index % 2 === 1 ? 'bg-brand-surface-alt' : 'bg-white',
    'hover:bg-brand-surface-hover',
  );
  // Job Separation's cell: compact, top-aligned, a rule between columns.
  const td = 'border-t border-r border-brand-line-soft px-3 py-2 align-top';

  const cardNo   = formatJobCardNumber(job.job_card_number);
  const due      = deliveryWords(job, today);
  const sep      = separationOf(job);

  return (
    <>
      <tr className={rowClass}>
        {/* ── Sr No: the job card number. The whole cell opens job detail,
             and it stays pinned left while the other columns scroll past —
             on the same mint fill as Job Separation's Sr No. ──────────── */}
        <td className={cn(td, 'sticky left-0 z-[1] min-w-[120px] bg-[var(--glass-bg-strong)] p-0')}>
          <Link
            href={`/admin/jobs/${job.id}`}
            aria-label={`Open job ${cardNo ?? job.po_number} in detail`}
            className={cn(
              'group/open flex h-full flex-col gap-0.5 px-3 py-2 focus:outline-none',
              'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-primary',
            )}
          >
            <span className="flex items-center gap-1.5">
              <span className={cn(
                'font-mono text-[13px] font-bold tracking-wide underline decoration-transparent underline-offset-[3px] transition-[text-decoration-color] group-hover/open:decoration-current',
                cardNo ? 'text-brand-ink' : 'text-brand-muted',
              )}>
                {cardNo ?? 'No card no.'}
              </span>
              {job.urgent && (
                <span className={cn(
                  'font-mono text-[11px] font-semibold tracking-[0.04em]',
                  job.urgent_priority === 1 ? 'text-brand-danger' : job.urgent_priority === 2 ? 'text-[#C2410C]' : 'text-brand-warning',
                )}>
                  {job.urgent_priority ? `P${job.urgent_priority}` : 'Urgent'}
                </span>
              )}
            </span>
          </Link>
        </td>

        {/* ── Party, plus what the floor needs to know about this job:
             its type, a hold reason, split runs, notes. ───────────────── */}
        <td className={cn(td, 'min-w-[150px] whitespace-normal break-words')}>
          <p className="font-semibold leading-snug text-brand-ink">{job.party}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className={cn('rounded px-1.5 py-px text-[11px] font-medium', JOB_TYPE_BADGE[job.job_type])}>
              {job.job_type}
            </span>
            {job.has_partial_runs && <span className="text-[11px] font-medium text-brand-muted">Split runs</span>}
          </div>
          {job.halt_remark && job.status === 'On Hold' && (
            <p className="mt-1 flex items-start gap-1 text-xs text-brand-warning">
              <PauseCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="line-clamp-1">{job.halt_remark}</span>
            </p>
          )}
          {job.notes && (
            <p className="mt-0.5 line-clamp-1 text-xs text-brand-muted" title={job.notes}>{job.notes}</p>
          )}
        </td>

        {/* ── PO No / Date ─────────────────────────────────────────── */}
        <td className={cn(td, 'max-w-[140px] whitespace-nowrap')}>
          <p className={cn(
            'font-mono text-[13px] font-bold tracking-wide text-brand-ink',
            job.po_number.length > 12 && 'whitespace-normal break-all',
          )}>
            {job.po_number || '—'}
          </p>
          <p className="mt-0.5 text-xs text-brand-muted">{formatNumericDate(job.po_date) || '—'}</p>
        </td>

        {/* ── PM Code / Material: the line's material, else the job's own
             name for a job added directly. ─────────────────────────────── */}
        <td className={cn(td, 'w-[200px] min-w-0 whitespace-normal')}>
          <p className="font-mono text-[13px] font-bold tracking-wide text-brand-ink">{job.pm_code || '—'}</p>
          <p className="mt-0.5 break-words text-xs text-brand-muted">{sep?.material_name || job.job_name || '—'}</p>
        </td>

        {/* ── Qty / Rate, and how much of the order has left. ───────── */}
        <td className={cn(td, 'whitespace-nowrap')}>
          <p className="font-mono text-[13px] font-bold tracking-wide text-brand-ink">
            {job.label_qty ? formatQty(job.label_qty) : '—'}
          </p>
          <p className="mt-0.5 font-mono text-xs text-brand-muted">@ {formatRate(sep?.rate ?? null) ?? '—'}</p>
          {job.label_qty && (actions.effectiveDispatched > 0 || job.is_scheduled_release) ? (
            <>
              <p className="mt-0.5 font-mono text-[11px] text-brand-muted">
                {formatQty(actions.effectiveDispatched)} sent{job.is_scheduled_release && ' · scheduled'}
              </p>
              <div
                className="mt-1 h-1 w-16 rounded-full bg-brand-sunken"
                role="progressbar"
                aria-valuenow={actions.dispatchPct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Dispatched ${actions.dispatchPct}% of order`}
              >
                <div className="h-full rounded-full bg-brand-primary" style={{ width: `${actions.dispatchPct}%` }} />
              </div>
            </>
          ) : null}
        </td>

        {/* ── Unit: the printing unit the job is on. ────────────────── */}
        <td className={cn(td, 'whitespace-nowrap')}>
          {job.printing_units ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-brand-ink">
              <span
                aria-hidden="true"
                className={cn(
                  'inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white',
                  unitCircleClass(job.printing_units.name),
                )}
              >
                {unitDigit(job.printing_units.name)}
              </span>
              {job.printing_units.name}
            </span>
          ) : (sep?.unit || '—')}
        </td>

        {/* ── Stage ────────────────────────────────────────────────── */}
        <td className={cn(td, 'w-[230px] min-w-[220px]')}>
          <StageSelect job={job} dept={dept} actions={actions} jobLabel={cardNo ?? job.po_number} />

          {job.status === 'Slitting' && job.slitting_confirmed_at && (
            <p className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-brand-success">
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Ready for QC
            </p>
          )}

          {actions.canConfirmSlitting && (
            <button
              onClick={actions.openSlitting}
              disabled={actions.submitting}
              className={cn(
                'mt-1.5 inline-flex w-full items-center justify-center gap-1 whitespace-nowrap rounded-lg px-2 py-1.5',
                'bg-brand-primary text-[11px] font-semibold text-white hover:bg-[#0C4232]',
                'transition-colors disabled:opacity-60',
              )}
            >
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Mark Slitting Complete
            </button>
          )}
        </td>

        {/* ── Delivery Date: editable inline, and how it stands. ────── */}
        <td className={cn(td, 'min-w-[120px] whitespace-nowrap')}>
          <DeliveryDateEdit
            jobId={job.id}
            deliveryDate={job.delivery_date}
            dept={dept}
            plain
            onUpdated={(date) => onJobUpdated({ ...job, delivery_date: date })}
          />
          {due.text && (
            <p className={cn(
              'mt-0.5 text-xs',
              due.tone === 'late' ? 'font-medium text-brand-danger'
                : due.tone === 'soon' ? 'font-medium text-brand-warning'
                : 'text-brand-muted',
            )}>
              {due.text}
            </p>
          )}
        </td>

        {/* ── Actions: icon-only — the desk has a mouse, so hover/title
             tooltips carry the label instead of spelling it out in the row.
             w-8 px-0 makes each one a small square rather than a
             text-shaped button with nothing but an icon rattling in it. ── */}
        <td className={cn(td, 'min-w-[150px] border-r-0')}>
          <div className="flex items-center justify-end gap-1">
            <Button
              size="sm"
              icon={isExpanded ? ChevronUp : ChevronDown}
              onClick={() => onToggleExpand(job.id)}
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
          <td colSpan={JOB_ROW_COLS} className="border-t border-brand-line-soft bg-brand-surface-alt px-4 py-0">
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

// Memoised: JobsTable passes stable callbacks, so typing in the search box
// or expanding one row no longer re-renders every other row.
export default memo(JobRow);
