'use client';
// src/components/track/StagePipeline.tsx

import { cn, formatClientDate, formatQty } from '@/lib/utils';
import { REPEAT_SKIPPED_STAGES } from '@/lib/constants/stages';
import type { JobStageTimestamp } from '@/lib/types';
import type { Stage } from '@/lib/constants/stages';

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
  };
  completedStages: Stage[];
  statusLogs:      StatusLog[];
  visibleStages:   Stage[];
  stageTimestamps: JobStageTimestamp[];
};

export default function StagePipeline({
  job,
  completedStages,
  statusLogs,
  visibleStages,
  stageTimestamps,
}: Props) {
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
    <div className="bg-white border border-brand-border rounded-2xl p-5">
      <h3 className="text-sm font-semibold text-brand-accent mb-4">Order Progress</h3>

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
                idx < allDisplayStages.length - 1 && 'border-b border-brand-border/40',
                isSkipped && 'opacity-40'
              )}
            >
              {/* Dot + connector line */}
              <div className="relative flex flex-col items-center shrink-0 pt-0.5">
                {/* Dot */}
                {isSkipped ? (
                  <div className="w-3 h-3 rounded-full border-2 border-dashed border-brand-muted" />
                ) : isCompleted && isOnHold ? (
                  <div className="w-3 h-3 rounded-full bg-amber-500" />
                ) : isCompleted && isQC ? (
                  <div className="w-3 h-3 rounded-full bg-sky-500" />
                ) : isCompleted ? (
                  <div className="w-3 h-3 rounded-full bg-green-500 flex items-center justify-center">
                    <span className="text-white text-[8px] leading-none">✓</span>
                  </div>
                ) : isCurrent ? (
                  <div className="relative">
                    <div className="w-3 h-3 rounded-full bg-brand-accent dot-pulse" />
                  </div>
                ) : (
                  <div className="w-3 h-3 rounded-full border-2 border-brand-border bg-white" />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={cn(
                    'text-sm font-medium',
                    isCompleted ? 'text-emerald-700' :
                    isCurrent   ? 'text-brand-accent' :
                    isSkipped   ? 'text-brand-muted line-through' :
                    'text-brand-muted'
                  )}>
                    {stage}
                  </span>

                  {isCurrent && !isCompleted && (
                    <span className="text-xs bg-brand-accent text-white px-1.5 py-0.5 rounded-full">
                      In Progress
                    </span>
                  )}

                  {isSkipped && (
                    <span className="text-xs text-brand-muted italic">N/A — Repeat order</span>
                  )}
                  </div>

                  {startedAt && isCurrent && (
                    <p className="text-xs font-mono text-slate-900 whitespace-nowrap">
                      In progress since {formatClientDate(startedAt)}
                    </p>
                  )}

                  {completedAt && isCompleted && (
                    <p className="text-xs font-mono text-emerald-700 whitespace-nowrap">
                      Completed {formatClientDate(completedAt)}
                    </p>
                  )}
                </div>

                {/* Department + timestamp for completed stages */}
                {log && isCompleted && (
                  <p className="text-xs text-brand-muted mt-0.5">
                    {log.department_display} · {formatClientDate(log.changed_at)}
                  </p>
                )}

                {/* Halt remark for On Hold */}
                {isOnHold && log?.remark && (
                  <p className="text-xs text-amber-700 mt-1 bg-amber-50 rounded px-2 py-1">
                    {log.remark}
                  </p>
                )}

                {/* QC remark (if filled) */}
                {isQC && log?.remark && (
                  <p className="text-xs text-sky-700 mt-1 bg-sky-50 rounded px-2 py-1">
                    {log.remark}
                  </p>
                )}

                {/* Partial dispatch detail */}
                {stage === 'Partial Dispatch' && log?.qty_dispatched && (
                  <p className="text-xs text-brand-muted mt-0.5">
                    {formatQty(log.qty_dispatched)} dispatched
                    {job.remaining_qty ? ` — ${formatQty(job.remaining_qty)} remaining` : ''}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
