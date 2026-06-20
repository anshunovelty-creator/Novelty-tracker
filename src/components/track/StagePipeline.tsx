'use client';
// src/components/track/StagePipeline.tsx

import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { registerGsap } from '@/lib/gsap/register';
import { cn, formatClientDate, formatQty } from '@/lib/utils';
import { REPEAT_SKIPPED_STAGES } from '@/lib/constants/stages';
import type { JobStageTimestamp, PrintRun } from '@/lib/types';
import type { Stage } from '@/lib/constants/stages';

registerGsap();

type StatusLog = {
  id:                 string;
  job_id:             string;
  status:             string;
  department_display: string;
  changed_at:         string;
  remark:             string | null;
  qty_dispatched:     number | null;
};

type Props = {
  job: {
    status:   string;
    job_type: string;
    remaining_qty: number | null;
    dispatched_qty: number;
    label_qty?: number | null;
    total_qty_dispatched?: number;
    has_partial_runs?: boolean;
  };
  completedStages: Stage[];
  statusLogs:      StatusLog[];
  visibleStages:   Stage[];
  stageTimestamps: JobStageTimestamp[];
  printRuns?:      PrintRun[];
};

export default function StagePipeline({
  job,
  completedStages,
  statusLogs,
  visibleStages,
  stageTimestamps,
  printRuns = [],
}: Props) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const el = root.current;
    if (!el) return;
    const nodes = el.querySelectorAll('[data-stage-node]');
    const lines = el.querySelectorAll('[data-stage-line]');
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const tl = gsap.timeline();
      tl.fromTo(nodes, { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, stagger: 0.08, ease: 'back.out(1.7)' });
      tl.fromTo(lines, { scaleY: 0, transformOrigin: 'top center' }, { scaleY: 1, duration: 0.25, stagger: 0.08 }, '<0.1');
    });
    mm.add('(prefers-reduced-motion: reduce)', () => { gsap.set([nodes, lines], { clearProps: 'all' }); });
    return () => mm.revert();
  }, { scope: root });

  // Build a map: stage → most recent log entry
  const logMap = new Map<string, StatusLog>();
  for (const log of statusLogs) {
    logMap.set(log.status, log); // last one wins (array is ordered by changed_at asc)
  }

  // Build a map: stage → entered timestamp
  const timestampMap = new Map<string, string>();
  for (const item of stageTimestamps) {
    timestampMap.set(item.stage, item.completed_at);
  }

  // All stages to display including special ones
  const allDisplayStages: Stage[] = [
    ...visibleStages,
    ...(completedStages.includes('On Hold') ? ['On Hold' as Stage] : []),
  ];

  function getDisplayTime(stage: Stage) {
    const startedAt = timestampMap.get(stage) ?? null;
    const stageIndex = allDisplayStages.indexOf(stage);

    if (stage === 'PO Closed') {
      return startedAt;
    }

    if (stageIndex < 0) return null;

    for (let i = stageIndex + 1; i < allDisplayStages.length; i += 1) {
      const nextStage = allDisplayStages[i];
      const nextStartedAt = timestampMap.get(nextStage);
      if (nextStartedAt) return nextStartedAt;
    }

    return null;
  }

  return (
    <div ref={root} className="glass rounded-2xl p-5">
      <h3 className="text-sm font-semibold text-[var(--glass-ink)] mb-4">Order Progress</h3>

      <div className="space-y-0">
        {allDisplayStages.map((stage, idx) => {
          const isSkipped   = job.job_type === 'Repeat' && REPEAT_SKIPPED_STAGES.includes(stage as any);
          const isCurrent   = job.status === stage && stage !== 'PO Closed' && !isSkipped;
          const hasTimestamp = Boolean(timestampMap.get(stage));
          const isCompleted = hasTimestamp && !isCurrent;
          const isOnHold    = stage === 'On Hold';
          const isQC        = stage === 'Quality Check';
          const log         = logMap.get(stage);
          const startedAt   = timestampMap.get(stage) ?? null;
          const completedAt = getDisplayTime(stage);

          return (
            <div
              key={stage}
              className={cn(
                'flex items-start gap-3 py-3',
                idx < allDisplayStages.length - 1 && 'border-b border-white/10',
                isSkipped && 'opacity-40'
              )}
            >
              {/* Dot + connector line */}
              <div className="relative flex flex-col items-center shrink-0 pt-0.5">
                {/* Dot */}
                {isSkipped ? (
                  <div data-stage-node className="w-3 h-3 rounded-full border-2 border-dashed border-white/30" />
                ) : isCompleted && isOnHold ? (
                  <div data-stage-node className="w-3 h-3 rounded-full bg-amber-500" />
                ) : isCompleted && isQC ? (
                  <div data-stage-node className="w-3 h-3 rounded-full bg-sky-500" />
                ) : isCompleted ? (
                  <div data-stage-node className="w-3 h-3 rounded-full bg-green-500 flex items-center justify-center">
                    <span className="text-white text-[8px] leading-none">✓</span>
                  </div>
                ) : isCurrent ? (
                  <div className="relative">
                    <div data-stage-node className="w-3 h-3 rounded-full bg-emerald-400 dot-pulse" />
                  </div>
                ) : (
                  <div data-stage-node className="w-3 h-3 rounded-full border-2 border-white/25 bg-white/5" />
                )}
                {/* Vertical connector line between consecutive stage nodes */}
                {idx < allDisplayStages.length - 1 && (
                  <div data-stage-line className="w-px flex-1 min-h-[1rem] bg-white/10 mt-1" />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={cn(
                    'text-sm font-medium',
                    isCompleted ? 'text-emerald-200' :
                    isCurrent   ? 'text-[var(--glass-ink)]' :
                    isSkipped   ? 'text-[var(--glass-muted)] line-through' :
                    'text-[var(--glass-muted)]'
                  )}>
                    {stage}
                  </span>

                  {isCurrent && !isCompleted && (
                    <span className="text-xs bg-brand-primary text-white px-1.5 py-0.5 rounded-full">
                      In Progress
                    </span>
                  )}

                  {isSkipped && (
                    <span className="text-xs text-[var(--glass-muted)] italic">N/A — Repeat order</span>
                  )}
                  </div>

                  {startedAt && isCurrent && (
                    <p className="text-xs font-mono text-[var(--glass-muted)] whitespace-nowrap">
                      In progress since {formatClientDate(startedAt)}
                    </p>
                  )}

                  {completedAt && isCompleted && (
                    <p className="text-xs font-mono text-emerald-200 whitespace-nowrap">
                      Completed {formatClientDate(completedAt)}
                    </p>
                  )}
                </div>

                {/* Department + timestamp for completed stages */}
                {log && isCompleted && (
                  <p className="text-xs text-[var(--glass-muted)] mt-0.5">
                    {log.department_display} · {formatClientDate(log.changed_at)}
                  </p>
                )}

                {/* Halt remark for On Hold */}
                {isOnHold && log?.remark && (
                  <p className="text-xs text-amber-200 mt-1 bg-amber-400/10 rounded px-2 py-1">
                    {log.remark}
                  </p>
                )}

                {/* QC remark (if filled) */}
                {isQC && log?.remark && (
                  <p className="text-xs text-sky-200 mt-1 bg-sky-400/10 rounded px-2 py-1">
                    {log.remark}
                  </p>
                )}

                {/* Partial dispatch detail */}
                {stage === 'Partial Dispatch' && log?.qty_dispatched && (
                  <p className="text-xs text-[var(--glass-muted)] mt-0.5">
                    {formatQty(log.qty_dispatched)} dispatched
                    {job.remaining_qty ? ` — ${formatQty(job.remaining_qty)} remaining` : ''}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Print runs — multi-cycle orders show each run as its own timeline entry */}
      {job.has_partial_runs && printRuns.length > 0 && (
        <div className="mt-5 pt-4 border-t border-white/10">
          <h4 className="text-sm font-semibold text-[var(--glass-ink)] mb-3">Production Cycles</h4>

          <div className="space-y-0">
            {printRuns.map((run, idx) => {
              const isDelivered = run.status === 'dispatched';
              return (
                <div
                  key={run.id}
                  className={cn(
                    'flex items-start gap-3 py-3',
                    idx < printRuns.length - 1 && 'border-b border-white/10'
                  )}
                >
                  {/* Dot */}
                  <div className="shrink-0 pt-0.5">
                    {isDelivered ? (
                      <div className="w-3 h-3 rounded-full bg-green-500 flex items-center justify-center">
                        <span className="text-white text-[8px] leading-none">✓</span>
                      </div>
                    ) : (
                      <div className="w-3 h-3 rounded-full bg-emerald-400 dot-pulse" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 flex items-start justify-between gap-3 flex-wrap">
                    <span className={cn(
                      'text-sm font-medium',
                      isDelivered ? 'text-emerald-200' : 'text-[var(--glass-ink)]'
                    )}>
                      Run {run.run_number}: {formatQty(run.qty_this_run)} labels —{' '}
                      {isDelivered ? 'Delivered ✅' : `In Production (${run.current_stage}) 🔄`}
                    </span>
                    {run.dispatched_at && (
                      <p className="text-xs font-mono text-emerald-200 whitespace-nowrap">
                        {formatClientDate(run.dispatched_at)}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Bottom summary */}
          {job.label_qty ? (
            <p className="text-sm text-[var(--glass-ink)] bg-white/10 rounded-lg px-3 py-2 mt-2">
              <strong className="font-mono">{formatQty(job.total_qty_dispatched ?? 0)}</strong> of{' '}
              <strong className="font-mono">{formatQty(job.label_qty)}</strong> delivered.{' '}
              <strong className="font-mono text-amber-200">
                {formatQty(job.label_qty - (job.total_qty_dispatched ?? 0))}
              </strong>{' '}
              remaining.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
