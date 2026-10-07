'use client';
// src/components/admin/JobPipeline.tsx
// The job page's Pipeline card: every stage top to bottom on one rail —
// done (filled, with who and when), now (ringed in the stage's colour),
// skipped (dashed, struck through: a Repeat skips sample and shade card),
// and still to come. Remarks recorded at a stage (QC note, hold reason) sit
// under its name. Read-only — the stage control in the header changes it.

import { useMemo } from 'react';
import { Check } from 'lucide-react';
import { cn, formatAdminDate } from '@/lib/utils';
import { PIPELINE_STAGES, REPEAT_SKIPPED_STAGES, isPerReleaseStage } from '@/lib/constants/stages';
import { STAGE_DOT } from '@/lib/constants/statusColors';
import { useDepartments } from '@/hooks/useReferenceData';
import type { Job, JobDetail, JobStatusLog } from '@/lib/types';

type RowState = 'done' | 'now' | 'skip' | 'next' | 'release';

export default function JobPipeline({ job, detail }: { job: Job; detail: JobDetail | null }) {
  const { data: departments } = useDepartments();
  const deptName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const d of departments ?? []) m[d.key] = d.display_name;
    return (k: string) => m[k] ?? k;
  }, [departments]);

  const reached = new Map((detail?.stage_timestamps ?? []).map((t) => [t.stage, t.completed_at]));
  const lastLog = new Map<string, JobStatusLog>();
  for (const l of detail?.status_logs ?? []) lastLog.set(l.status, l);

  const rows = PIPELINE_STAGES.map((stage) => {
    let state: RowState;
    if (job.job_type === 'Repeat' && REPEAT_SKIPPED_STAGES.includes(stage)) state = 'skip';
    else if (stage === job.status) state = 'now';
    else if (reached.has(stage)) state = 'done';
    else if (job.is_scheduled_release && isPerReleaseStage(stage)) state = 'release';
    else state = 'next';
    const log = lastLog.get(stage);
    return { stage, state, at: reached.get(stage) ?? log?.changed_at ?? null, log };
  });

  const counted   = rows.filter((r) => r.state !== 'skip');
  const doneCount = counted.filter((r) => r.state === 'done' || r.state === 'now').length;
  const skipped   = rows.length - counted.length;
  const hold      = job.status === 'On Hold' ? lastLog.get('On Hold') : undefined;

  return (
    <section aria-label="Pipeline" className="rounded-2xl border border-brand-border bg-white p-5 shadow-[0_2px_8px_rgba(12,42,32,0.04)]">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-brand-ink">Pipeline</h2>
        <span className="text-xs text-brand-muted">
          <span className="font-mono">{doneCount}</span> of <span className="font-mono">{counted.length}</span> stages
          {skipped > 0 && ` · ${skipped} skipped for repeat`}
        </span>
      </div>

      {(job.status === 'On Hold' || job.status === 'PO Closed') && (
        <p className={cn(
          'mb-3 rounded-xl px-3.5 py-2.5 text-[13px]',
          job.status === 'On Hold' ? 'bg-[#FFFBEB] text-brand-warning' : 'bg-brand-sunken text-brand-ink',
        )}>
          <strong className="font-semibold">{job.status === 'On Hold' ? 'On hold' : 'PO closed'}</strong>
          {hold && <> since <span className="font-mono">{formatAdminDate(hold.changed_at)}</span> · {deptName(hold.changed_by_dept)}</>}
          {job.status === 'On Hold' && (hold?.remark || job.halt_remark) && <> — {hold?.remark || job.halt_remark}</>}
        </p>
      )}

      {!detail ? (
        <div className="space-y-3" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-8 rounded-lg bg-brand-sunken" />)}
        </div>
      ) : (
        <ol className="flex flex-col">
          {rows.map((r, i) => {
            const prev = rows[i - 1];
            const filledAbove = Boolean(prev) && ['done', 'skip', 'now'].includes(prev.state) && !['next', 'release'].includes(r.state);
            const filledBelow = r.state === 'done' || r.state === 'skip';
            return (
              <li key={r.stage} className={cn('flex gap-3.5 px-2.5', r.state === 'now' && 'rounded-xl bg-[#ECFEFF]')}>
                <div className="flex w-6 flex-col items-center" aria-hidden="true">
                  <span className={cn('min-h-3 w-0.5 flex-1', i === 0 ? 'bg-transparent' : filledAbove ? 'bg-brand-primary' : 'bg-brand-border')} />
                  <span
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                      r.state === 'done' && 'bg-brand-primary text-white',
                      r.state === 'now' && 'border-2 bg-white',
                      r.state === 'skip' && 'border-[1.5px] border-dashed border-[#B8C4BD] bg-white',
                      (r.state === 'next' || r.state === 'release') && 'border-[1.5px] border-[#CFDAD3] bg-white',
                    )}
                    style={r.state === 'now' ? { borderColor: STAGE_DOT[r.stage], boxShadow: `0 0 0 5px ${STAGE_DOT[r.stage]}26` } : undefined}
                  >
                    {r.state === 'done' && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <span className={cn('min-h-3 w-0.5 flex-1', i === rows.length - 1 ? 'bg-transparent' : filledBelow ? 'bg-brand-primary' : 'bg-brand-border')} />
                </div>
                <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
                  <div className="flex min-w-0 flex-[1_1_180px] flex-col gap-0.5">
                    <span className={cn(
                      'text-sm',
                      r.state === 'now' && 'font-semibold text-brand-ink',
                      r.state === 'done' && 'text-brand-ink',
                      r.state === 'skip' && 'text-[#8A9A91] line-through',
                      (r.state === 'next' || r.state === 'release') && 'text-brand-muted',
                    )}>
                      {r.stage}
                      <span className="sr-only">
                        {r.state === 'done' ? ' — done' : r.state === 'now' ? ' — current stage' : r.state === 'skip' ? ' — skipped' : ' — not yet'}
                      </span>
                    </span>
                    {r.log?.remark && r.state !== 'skip' && (
                      <span className="text-[13px] text-brand-muted">{r.log.remark}</span>
                    )}
                    {r.log?.qty_dispatched != null && (
                      <span className="text-[13px] text-brand-muted">
                        <span className="font-mono">{r.log.qty_dispatched.toLocaleString('en-IN')}</span> labels sent
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 whitespace-nowrap">
                    {r.log && r.state !== 'skip' && <span className="text-xs text-brand-muted">{deptName(r.log.changed_by_dept)}</span>}
                    <span className="font-mono text-xs text-brand-ink sm:min-w-[112px] sm:text-right">
                      {r.state === 'skip' ? <span className="text-brand-muted">Skipped</span>
                        : r.state === 'release' && !r.at ? <span className="text-brand-muted">Per release</span>
                        : r.at ? `${r.state === 'now' ? 'Since ' : ''}${formatAdminDate(r.at)}`
                        : r.stage === 'Partial Dispatch' ? <span className="text-brand-muted">Optional</span>
                        : <span className="text-brand-muted">—</span>}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
