'use client';
// src/components/admin/HistoryPanel.tsx

import { useEffect, useState, useCallback } from 'react';
import { cn, formatAdminDate, formatShortDate, formatQty } from '@/lib/utils';
import { PIPELINE_STAGES, REPEAT_SKIPPED_STAGES } from '@/lib/constants/stages';
import { DEPT_DISPLAY_NAME } from '@/lib/constants/departments';
import type { JobDetail, JobStatusLog, StageComment, DispatchSchedule, PrintRun, PrintRunStage } from '@/lib/types';
import type { Stage } from '@/lib/constants/stages';
import type { Department } from '@/lib/constants/departments';
import StageComments from './StageComments';
import { PrintRunModal } from './modals';
import toast from 'react-hot-toast';

type Props = {
  jobId:               string;
  jobType:             'New' | 'Repeat' | 'Artwork Changed';
  isScheduledRelease:  boolean;
  dept:                Department;
  refreshKey?:         string;   // pass job.updated_at — re-fetches after status changes
};

export default function HistoryPanel({ jobId, jobType, isScheduledRelease, dept, refreshKey }: Props) {
  const [detail,   setDetail]   = useState<JobDetail | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  // Bumped by the print-runs section after a run changes, so job totals refresh
  const [tick,     setTick]     = useState(0);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        const data = await res.json();
        if (res.ok) setDetail(data.job);
        else setError(data.error);
      } catch {
        setError('Failed to load history');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [jobId, refreshKey, tick]);

  if (loading) {
    return (
      <div className="py-6 text-sm text-brand-muted text-center">
        Loading history…
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="py-6 text-sm text-red-500 text-center">
        {error ?? 'Failed to load history'}
      </div>
    );
  }

  const timestampMap = new Map<string, string>(
    detail.stage_timestamps.map((t) => [t.stage, t.completed_at])
  );

  const logMap = new Map<string, JobStatusLog[]>();
  for (const log of detail.status_logs) {
    if (!logMap.has(log.status)) logMap.set(log.status, []);
    logMap.get(log.status)!.push(log);
  }

  const commentMap = new Map<string, StageComment[]>();
  for (const c of detail.stage_comments) {
    if (!commentMap.has(c.stage)) commentMap.set(c.stage, []);
    commentMap.get(c.stage)!.push(c);
  }

  const visiblePipeline: Stage[] = [
    ...PIPELINE_STAGES,
    'On Hold',
  ];

  return (
    <div className="py-4 space-y-6">

      {/* Stage history */}
      <div>
        <h4 className="text-xs font-medium text-brand-muted uppercase tracking-wide mb-3">
          Stage History
        </h4>
        <div className="space-y-0">
          {visiblePipeline.map((stage) => {
            const isSkipped = jobType === 'Repeat' && REPEAT_SKIPPED_STAGES.includes(stage as any);
            const completedAt = timestampMap.get(stage);
            const logs = logMap.get(stage) ?? [];
            const comments = commentMap.get(stage) ?? [];
            const latestLog = logs[logs.length - 1];

            return (
              <div
                key={stage}
                className={cn(
                  'flex items-start gap-3 py-2.5 border-b border-brand-border/50 last:border-0',
                  isSkipped && 'opacity-40'
                )}
              >
                {/* Status dot */}
                <div className="mt-0.5 shrink-0">
                  {isSkipped ? (
                    <div className="w-2 h-2 rounded-full border border-dashed border-brand-muted" />
                  ) : completedAt ? (
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                  ) : (
                    <div className="w-2 h-2 rounded-full bg-brand-border" />
                  )}
                </div>

                {/* Stage info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn(
                      'text-sm font-medium',
                      completedAt ? 'text-brand-accent' : 'text-brand-muted',
                      isSkipped && 'line-through'
                    )}>
                      {stage}
                    </span>
                    {isSkipped && (
                      <span className="text-xs text-brand-muted italic">N/A — Repeat</span>
                    )}
                  </div>

                  {latestLog && (
                    <p className="text-xs text-brand-muted font-mono mt-0.5">
                      {DEPT_DISPLAY_NAME[latestLog.changed_by_dept as Department] ?? latestLog.changed_by_dept}
                      {' · '}
                      {formatAdminDate(latestLog.changed_at)}
                    </p>
                  )}

                  {/* Halt remark */}
                  {stage === 'On Hold' && latestLog?.remark && (
                    <p className="text-xs text-amber-700 mt-1">
                      Reason: {latestLog.remark}
                    </p>
                  )}

                  {/* QC remark */}
                  {stage === 'Quality Check' && latestLog?.remark && (
                    <p className="text-xs text-sky-700 mt-1">
                      QC note: {latestLog.remark}
                    </p>
                  )}

                  {/* Internal stage comments */}
                  {comments.length > 0 && (
                    <div className="mt-1 space-y-1">
                      {comments.map((c) => (
                        <p key={c.id} className="text-xs text-brand-muted bg-brand-bg rounded px-2 py-1">
                          <span className="font-medium">{c.created_by}:</span> {c.comment}
                          <span className="ml-2 opacity-50">{formatAdminDate(c.created_at)}</span>
                        </p>
                      ))}
                    </div>
                  )}

                  {/* Add comment inline */}
                  <StageComments
                    jobId={jobId}
                    stage={stage}
                    dept={dept}
                    existingComments={comments}
                    onCommentAdded={(comment) => {
                      setDetail((current) => {
                        if (!current) return current;

                        return {
                          ...current,
                          stage_comments: [...current.stage_comments, comment],
                        };
                      });
                    }}
                  />
                </div>

                {/* Timestamp */}
                {completedAt && !isSkipped && (
                  <p className="text-xs font-mono text-brand-muted shrink-0">
                    {formatShortDate(completedAt)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Print runs (multi-cycle orders) */}
      <PrintRunsSection
        job={detail}
        dept={dept}
        onChanged={() => setTick((t) => t + 1)}
      />

      {/* Scheduled release table */}
      {isScheduledRelease && detail.dispatch_schedules.length > 0 && (
        <ScheduledReleaseTable
          schedules={detail.dispatch_schedules}
          dept={dept}
          onRefresh={() => {
            // Re-fetch full job detail after a release dispatch
            setDetail(null);
            setLoading(true);
            fetch(`/api/jobs/${jobId}`)
              .then((r) => r.json())
              .then((d) => { if (d.job) setDetail(d.job); })
              .finally(() => setLoading(false));
          }}
        />
      )}
    </div>
  );
}

// ── Print Runs Section ────────────────────────────────────────
// Shown when a job has print runs (multi-cycle orders).
// Each run card shows qty + stage; the active run gets an advance
// button gated by department. When all runs are dispatched and qty
// remains, Production/Admin see "Start Next Print Run".

const NEXT_RUN_STAGE: Record<PrintRunStage, PrintRunStage | null> = {
  Printing:   'QC',
  QC:         'Packing',
  Packing:    'Dispatched',
  Dispatched: null,
};

// Mirror of the API's department gates (Admin always allowed)
const RUN_STAGE_DEPTS: Record<PrintRunStage, Department[]> = {
  Printing:   ['Production'],
  QC:         ['QC'],
  Packing:    ['Dispatch'],
  Dispatched: ['Dispatch'],
};

function PrintRunsSection({
  job,
  dept,
  onChanged,
}: {
  job:       JobDetail;
  dept:      Department;
  onChanged: () => void;
}) {
  const [runs,        setRuns]        = useState<PrintRun[]>([]);
  const [loaded,      setLoaded]      = useState(false);
  const [advancingId, setAdvancingId] = useState<string | null>(null);
  const [showModal,   setShowModal]   = useState(false);

  const loadRuns = useCallback(async () => {
    try {
      const res  = await fetch(`/api/jobs/${job.id}/print-runs`);
      const data = await res.json();
      if (res.ok) setRuns(data.print_runs ?? []);
    } finally {
      setLoaded(true);
    }
  }, [job.id]);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  if (!loaded || runs.length === 0) return null;

  const totalQty       = job.label_qty ?? 0;
  const dispatchedQty  = job.total_qty_dispatched ?? 0;
  const remainingQty   = totalQty - dispatchedQty;
  const allDispatched  = runs.every((r) => r.status === 'dispatched');
  const awaitingNext   = job.has_partial_runs && allDispatched && remainingQty > 0;
  const canStartNext   = awaitingNext && (dept === 'Production' || dept === 'Admin');

  async function advanceRun(run: PrintRun) {
    const nextStage = NEXT_RUN_STAGE[run.current_stage];
    if (!nextStage) return;

    setAdvancingId(run.id);
    try {
      const res  = await fetch(`/api/jobs/${job.id}/print-runs/${run.id}/stage`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ new_stage: nextStage }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to advance run');
        return;
      }
      toast.success(`Run #${run.run_number} → ${nextStage}`);
      await loadRuns();
      onChanged();   // refresh job totals in the parent panel
    } catch {
      toast.error('Network error. Try again.');
    } finally {
      setAdvancingId(null);
    }
  }

  async function startNextRun(payload: {
    qty_this_run: number;
    more_runs:    boolean;
    notes:        string;
  }) {
    setShowModal(false);
    try {
      const res  = await fetch(`/api/jobs/${job.id}/print-runs`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to start print run');
        return;
      }
      toast.success(`Run #${data.print_run.run_number} started — Printing`);
      await loadRuns();
      onChanged();
    } catch {
      toast.error('Network error. Try again.');
    }
  }

  return (
    <div>
      <h4 className="text-xs font-medium text-brand-muted uppercase tracking-wide mb-3">
        Print Runs
      </h4>

      <div className="space-y-2">
        {runs.map((run) => {
          const isDone    = run.status === 'dispatched';
          const nextStage = NEXT_RUN_STAGE[run.current_stage];
          const mayAdvance =
            !isDone && nextStage !== null &&
            (dept === 'Admin' || RUN_STAGE_DEPTS[nextStage].includes(dept));

          return (
            <div
              key={run.id}
              className={cn(
                'flex items-center justify-between gap-3 rounded-lg border px-4 py-3',
                isDone ? 'border-green-200 bg-green-50/50' : 'border-brand-border bg-white'
              )}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-brand-accent">
                  Run #{run.run_number}
                  <span className="ml-2 font-mono text-xs text-brand-muted">
                    {formatQty(run.qty_this_run)} labels
                  </span>
                </p>
                <p className="text-xs text-brand-muted mt-0.5">
                  Stage: <strong className={isDone ? 'text-green-700' : 'text-brand-accent'}>
                    {run.current_stage} {isDone ? '✅' : '🔄'}
                  </strong>
                  {run.dispatched_at && (
                    <span className="ml-2 font-mono">{formatShortDate(run.dispatched_at)}</span>
                  )}
                </p>
                {run.notes && (
                  <p className="text-xs text-brand-muted mt-0.5 truncate">{run.notes}</p>
                )}
              </div>

              {!isDone && nextStage && (
                mayAdvance ? (
                  <button
                    onClick={() => advanceRun(run)}
                    disabled={advancingId === run.id}
                    className={cn(
                      'shrink-0 text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors',
                      nextStage === 'Dispatched'
                        ? 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100'
                        : 'bg-brand-bg border-brand-border text-brand-accent hover:bg-brand-border/40',
                      'disabled:opacity-40'
                    )}
                  >
                    {advancingId === run.id ? 'Saving…' : `→ ${nextStage}`}
                  </button>
                ) : (
                  <span className="shrink-0 text-xs text-brand-muted">
                    🔒 {RUN_STAGE_DEPTS[nextStage].join('/')}
                  </span>
                )
              )}
            </div>
          );
        })}
      </div>

      {/* Totals */}
      <div className="bg-brand-bg border border-brand-border rounded-lg px-3 py-2 flex gap-6 text-xs font-mono mt-2">
        <span>Total: <strong>{formatQty(totalQty)}</strong></span>
        <span className="text-green-700">Dispatched: <strong>{formatQty(dispatchedQty)}</strong></span>
        <span className="text-amber-700">Remaining: <strong>{formatQty(remainingQty)}</strong></span>
      </div>

      {/* Between runs */}
      {awaitingNext && (
        <div className="flex items-center justify-between gap-3 mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <p className="text-xs text-amber-700">
            ⏳ Awaiting next print run — {formatQty(remainingQty)} labels remaining
          </p>
          {canStartNext && (
            <button
              onClick={() => setShowModal(true)}
              className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-brand-accent text-white font-medium hover:bg-brand-accent/90 transition-colors"
            >
              Start Next Print Run
            </button>
          )}
        </div>
      )}

      {showModal && (
        <PrintRunModal
          totalQty={totalQty}
          alreadyDispatched={dispatchedQty}
          onCancel={() => setShowModal(false)}
          onConfirm={startNextRun}
        />
      )}
    </div>
  );
}

// ── Scheduled Release Table ───────────────────────────────────

function ScheduledReleaseTable({
  schedules,
  dept,
  onRefresh,
}: {
  schedules:  DispatchSchedule[];
  dept:       Department;
  onRefresh:  () => void;
}) {
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);

  const totalQty    = schedules.reduce((sum, s) => sum + s.planned_qty, 0);
  const releasedQty = schedules
    .filter((s) => s.status === 'Dispatched')
    .reduce((sum, s) => sum + (s.actual_qty ?? s.planned_qty), 0);
  const remainingQty = totalQty - releasedQty;

  const canDispatch = dept === 'Dispatch' || dept === 'Admin';

  async function handleDispatchRelease(schedule: DispatchSchedule) {
    const qty = window.prompt(
      `Dispatch Release ${schedule.release_number}\nPlanned qty: ${schedule.planned_qty.toLocaleString('en-IN')}\n\nEnter actual qty dispatched:`,
      String(schedule.planned_qty)
    );
    if (!qty || isNaN(Number(qty))) return;

    setDispatchingId(schedule.id);
    try {
      const res = await fetch(`/api/dispatch-schedules/${schedule.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ actual_qty: Number(qty) }),
      });
      if (res.ok) {
        onRefresh();
      } else {
        const data = await res.json();
        alert(data.error ?? 'Failed to dispatch release');
      }
    } finally {
      setDispatchingId(null);
    }
  }

  return (
    <div>
      <h4 className="text-xs font-medium text-brand-muted uppercase tracking-wide mb-3">
        Release Schedule
      </h4>

      <div className="rounded-lg border border-brand-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-brand-bg border-b border-brand-border">
              <th className="px-3 py-2 text-left text-xs text-brand-muted">Release</th>
              <th className="px-3 py-2 text-left text-xs text-brand-muted">Planned Qty</th>
              <th className="px-3 py-2 text-left text-xs text-brand-muted">Planned Date</th>
              <th className="px-3 py-2 text-left text-xs text-brand-muted">Status</th>
              <th className="px-3 py-2 text-left text-xs text-brand-muted">Actual Date</th>
              {canDispatch && <th className="px-3 py-2 text-left text-xs text-brand-muted">Action</th>}
            </tr>
          </thead>
          <tbody>
            {schedules.map((s) => (
              <tr key={s.id} className="border-b border-brand-border/50 last:border-0">
                <td className="px-3 py-2 font-mono text-xs">R{s.release_number}</td>
                <td className="px-3 py-2 font-mono text-xs">{formatQty(s.planned_qty)}</td>
                <td className="px-3 py-2 text-xs">{formatShortDate(s.planned_date)}</td>
                <td className="px-3 py-2">
                  <span className={cn(
                    'text-xs px-1.5 py-0.5 rounded font-medium',
                    s.status === 'Dispatched' ? 'bg-green-100 text-green-700' :
                    s.status === 'In Progress' ? 'bg-blue-100 text-blue-700' :
                    'bg-gray-100 text-gray-600'
                  )}>
                    {s.status === 'Dispatched' ? '✓ Dispatched' :
                     s.status === 'In Progress' ? 'In Progress' : '⏳ Pending'}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-brand-muted">
                  {s.actual_date ? formatShortDate(s.actual_date) : '—'}
                </td>
                {canDispatch && (
                  <td className="px-3 py-2">
                    {s.status !== 'Dispatched' ? (
                      <button
                        onClick={() => handleDispatchRelease(s)}
                        disabled={dispatchingId === s.id}
                        className={cn(
                          'text-xs px-2 py-1 rounded border font-medium transition-colors',
                          'bg-green-50 border-green-200 text-green-700 hover:bg-green-100',
                          'disabled:opacity-40'
                        )}
                      >
                        {dispatchingId === s.id ? 'Saving…' : 'Dispatch'}
                      </button>
                    ) : (
                      <span className="text-xs text-brand-muted">—</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals row */}
        <div className="bg-brand-bg border-t border-brand-border px-3 py-2 flex gap-6 text-xs font-mono">
          <span>Total: <strong>{formatQty(totalQty)}</strong></span>
          <span className="text-green-700">Released: <strong>{formatQty(releasedQty)}</strong></span>
          <span className="text-amber-700">Remaining: <strong>{formatQty(remainingQty)}</strong></span>
        </div>
      </div>
    </div>
  );
}
