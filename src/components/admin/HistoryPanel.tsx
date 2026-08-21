'use client';
// src/components/admin/HistoryPanel.tsx

import { useEffect, useState, useCallback } from 'react';
import { CheckCircle2, RefreshCw, Clock, Lock } from 'lucide-react';
import { cn, formatAdminDate, formatShortDate, formatQty } from '@/lib/utils';
import { PIPELINE_STAGES, REPEAT_SKIPPED_STAGES } from '@/lib/constants/stages';
import { canDeptManagePrintRuns, canDeptSetRunStage } from '@/lib/constants/departments';
import { nextRunStage, RUN_STAGE_LABELS } from '@/lib/constants/runStages';
import { JOBS_CHANGED_EVENT } from '@/lib/constants/events';
import type { JobDetail, JobStatusLog, StageComment, DispatchSchedule, PrintRun } from '@/lib/types';
import type { Stage } from '@/lib/constants/stages';
import type { DeptPermissions } from '@/lib/constants/departments';
import StageComments from './StageComments';
import { PrintRunModal, PromptModal } from './modals';
import { SkeletonText } from '@/components/ui/Skeleton';
import toast from 'react-hot-toast';

type Props = {
  jobId:               string;
  jobType:             'New' | 'Repeat' | 'Artwork Changed';
  isScheduledRelease:  boolean;
  dept:                DeptPermissions;
  refreshKey?:         string;   // pass job.updated_at — re-fetches after status changes
};

export default function HistoryPanel({ jobId, jobType, isScheduledRelease, dept, refreshKey }: Props) {
  const [detail,   setDetail]   = useState<JobDetail | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  // Bumped by the releases section after a run/schedule changes, so job totals refresh
  const [tick,     setTick]     = useState(0);
  // key -> display_name, for showing which department made a past status change —
  // that log's department may not be the viewer's own, so it can't come from `dept`.
  const [deptNames, setDeptNames] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch('/api/departments')
      .then((res) => res.json())
      .then((data) => {
        const map: Record<string, string> = {};
        for (const d of data.departments ?? []) map[d.key] = d.display_name;
        setDeptNames(map);
      })
      .catch(() => {});
  }, []);

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
    return <SkeletonText lines={6} className="py-6" />;
  }

  if (error || !detail) {
    return (
      <div className="py-6 text-sm text-red-300 text-center">
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
        <h4 className="text-xs font-medium text-[var(--glass-muted)] uppercase tracking-wide mb-3">
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
                  'flex items-start gap-3 py-2.5 border-b border-white/8 last:border-0',
                  isSkipped && 'opacity-40'
                )}
              >
                {/* Status dot */}
                <div className="mt-0.5 shrink-0">
                  {isSkipped ? (
                    <div className="w-2 h-2 rounded-full border border-dashed border-white/30" />
                  ) : completedAt ? (
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                  ) : (
                    <div className="w-2 h-2 rounded-full bg-white/20" />
                  )}
                </div>

                {/* Stage info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn(
                      'text-sm font-medium',
                      completedAt ? 'text-[var(--glass-ink)]' : 'text-[var(--glass-muted)]',
                      isSkipped && 'line-through'
                    )}>
                      {stage}
                    </span>
                    {isSkipped && (
                      <span className="text-xs text-[var(--glass-muted)] italic">N/A — Repeat</span>
                    )}
                  </div>

                  {latestLog && (
                    <p className="text-xs text-[var(--glass-muted)] font-mono mt-0.5">
                      {deptNames[latestLog.changed_by_dept] ?? latestLog.changed_by_dept}
                      {' · '}
                      {formatAdminDate(latestLog.changed_at)}
                    </p>
                  )}

                  {/* Halt remark */}
                  {stage === 'On Hold' && latestLog?.remark && (
                    <p className="text-xs text-amber-200 mt-1">
                      Reason: {latestLog.remark}
                    </p>
                  )}

                  {/* QC remark */}
                  {stage === 'Quality Check' && latestLog?.remark && (
                    <p className="text-xs text-sky-200 mt-1">
                      QC note: {latestLog.remark}
                    </p>
                  )}

                  {/* Internal stage comments */}
                  {comments.length > 0 && (
                    <div className="mt-1 space-y-1">
                      {comments.map((c) => (
                        <p key={c.id} className="text-xs text-[var(--glass-muted)] bg-white/[0.06] rounded px-2 py-1">
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
                    dept={dept.key}
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
                  <p className="text-xs font-mono text-[var(--glass-muted)] shrink-0">
                    {formatShortDate(completedAt)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Releases & production runs — one unified section */}
      <ReleasesSection
        job={detail}
        isScheduledRelease={isScheduledRelease || detail.is_scheduled_release}
        dept={dept}
        onChanged={() => {
          // Refresh this panel, then tell the jobs table / detail header —
          // a dispatched release moves the job's totals, and each of them
          // holds its own copy of the job row.
          setTick((t) => t + 1);
          window.dispatchEvent(new Event(JOBS_CHANGED_EVENT));
        }}
      />
    </div>
  );
}

// ── Releases & Production Runs ────────────────────────────────
// ONE list for everything that ships. Each row is a release moving
// through a single lifecycle:
//   Planned (schedule only) → In Production (run advancing through the
//   per-run pipeline) → Dispatched
// Scheduled-release jobs: Admin adds the next release whenever its date
// becomes known; Production starts it; the stage chain does the rest.
// Non-scheduled multi-run jobs keep the Start Next Print Run flow —
// their runs are simply rows without a planned date.

function ReleasesSection({
  job,
  isScheduledRelease,
  dept,
  onChanged,
}: {
  job:                JobDetail;
  isScheduledRelease: boolean;
  dept:               DeptPermissions;
  onChanged:          () => void;
}) {
  const [runs,        setRuns]        = useState<PrintRun[]>([]);
  const [loaded,      setLoaded]      = useState(false);
  const [busyId,      setBusyId]      = useState<string | null>(null);
  const [showModal,   setShowModal]   = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  // Run awaiting a QC remark before advancing past QC
  const [qcRun,          setQcRun]          = useState<PrintRun | null>(null);
  // Schedule awaiting an override dispatch quantity
  const [overrideSched,  setOverrideSched]  = useState<DispatchSchedule | null>(null);

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

  const schedules = job.dispatch_schedules ?? [];

  if (!loaded || (!isScheduledRelease && runs.length === 0)) return null;

  const totalQty      = job.label_qty ?? 0;
  const dispatchedQty = job.total_qty_dispatched ?? 0;
  const remainingQty  = totalQty - dispatchedQty;
  const activeRun     = runs.find((r) => r.status === 'in_progress') ?? null;
  const runBySchedule = new Map(
    runs.filter((r) => r.schedule_id).map((r) => [r.schedule_id as string, r])
  );
  const orphanRuns = runs.filter((r) => !r.schedule_id);
  const hasPendingSchedule = schedules.some((s) => s.status === 'Pending');

  // Non-scheduled multi-run jobs: existing "Start Next Print Run" flow
  const awaitingNext =
    !isScheduledRelease && job.has_partial_runs && !activeRun && remainingQty > 0;
  const canStartNext = awaitingNext && canDeptManagePrintRuns(dept);

  // Scheduled jobs with nothing planned and quantity left
  const awaitingSchedule =
    isScheduledRelease && !hasPendingSchedule && !activeRun && remainingQty > 0;

  async function advanceRun(run: PrintRun, qcRemarkInput?: string) {
    const nextStage = nextRunStage(run.current_stage);
    if (!nextStage) return;

    // QC signs the release off when moving it past QC — capture the
    // per-release remark in a modal first (blank = no remark; Cancel aborts).
    if (run.current_stage === 'QC' && qcRemarkInput === undefined) {
      setQcRun(run);
      return;
    }
    const qcRemark =
      run.current_stage === 'QC' ? (qcRemarkInput?.trim() || undefined) : undefined;

    setBusyId(run.id);
    try {
      const res  = await fetch(`/api/jobs/${job.id}/print-runs/${run.id}/stage`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ new_stage: nextStage, qc_remark: qcRemark }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to advance run');
        return;
      }
      toast.success(`Run #${run.run_number} → ${RUN_STAGE_LABELS[nextStage]}`);
      await loadRuns();
      onChanged();   // refresh job totals + schedules in the parent panel
    } catch {
      toast.error('Network error. Try again.');
    } finally {
      setBusyId(null);
    }
  }

  async function startRunForSchedule(schedule: DispatchSchedule) {
    setBusyId(schedule.id);
    try {
      const res  = await fetch(`/api/jobs/${job.id}/print-runs`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ schedule_id: schedule.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to start production');
        return;
      }
      toast.success(`Release ${schedule.release_number} → production (Run #${data.print_run.run_number})`);
      await loadRuns();
      onChanged();
    } catch {
      toast.error('Network error. Try again.');
    } finally {
      setBusyId(null);
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

  // Admin escape hatch: force-dispatch a release without a production run.
  // Quantity is captured in a modal (see overrideSched); this runs on confirm.
  async function overrideDispatch(schedule: DispatchSchedule, qtyInput: string) {
    const qty = Number(qtyInput);
    if (!qty || Number.isNaN(qty)) return;

    setBusyId(schedule.id);
    try {
      const res = await fetch(`/api/dispatch-schedules/${schedule.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ actual_qty: qty }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to dispatch release');
        return;
      }
      toast.success(`Release ${schedule.release_number} dispatched (override)`);
      onChanged();
    } catch {
      toast.error('Network error. Try again.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-medium text-[var(--glass-muted)] uppercase tracking-wide">
          {isScheduledRelease ? 'Releases' : 'Print Runs'}
        </h4>
        {isScheduledRelease && dept.isSuperAdmin && !showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
            className="text-xs px-2.5 py-1 rounded-lg bg-brand-primary text-white font-medium hover:bg-brand-primary/90 transition-colors"
          >
            + Add Next Release
          </button>
        )}
      </div>

      {showAddForm && (
        <AddReleaseForm
          jobId={job.id}
          onDone={(added) => {
            setShowAddForm(false);
            if (added) onChanged();
          }}
        />
      )}

      <div className="space-y-2">
        {/* Scheduled releases — Planned → In Production → Dispatched */}
        {schedules.map((s) => {
          const run          = runBySchedule.get(s.id) ?? null;
          const isDispatched = s.status === 'Dispatched';

          return (
            <div
              key={s.id}
              className={cn(
                'rounded-lg border px-4 py-3',
                isDispatched ? 'border-emerald-300/25 bg-emerald-400/10' : 'glass'
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--glass-ink)]">
                    Release {s.release_number}
                    {run && (
                      <span className="ml-1.5 text-xs text-[var(--glass-muted)]">· Run #{run.run_number}</span>
                    )}
                    <span className="ml-2 font-mono text-xs text-[var(--glass-muted)]">
                      {formatQty(isDispatched ? (s.actual_qty ?? s.planned_qty) : s.planned_qty)} labels
                    </span>
                  </p>
                  <p className="inline-flex items-center gap-1 text-xs text-[var(--glass-muted)] mt-0.5">
                    {isDispatched ? (
                      <>
                        <CheckCircle2 className="w-3 h-3 text-emerald-200 shrink-0" aria-hidden="true" />
                        Dispatched
                        {s.actual_date && (
                          <span className="font-mono ml-1">{formatShortDate(s.actual_date)}</span>
                        )}
                      </>
                    ) : run ? (
                      <>
                        <RefreshCw className="w-3 h-3 text-sky-200 shrink-0" aria-hidden="true" />
                        Stage:{' '}
                        <strong className="text-[var(--glass-ink)]">
                          {RUN_STAGE_LABELS[run.current_stage]}
                        </strong>
                      </>
                    ) : (
                      <>
                        <Clock className="w-3 h-3 text-amber-200 shrink-0" aria-hidden="true" />
                        Planned for <span className="font-mono">{formatShortDate(s.planned_date)}</span>
                      </>
                    )}
                  </p>
                  {s.notes && (
                    <p className="text-xs text-[var(--glass-muted)] mt-0.5 truncate">{s.notes}</p>
                  )}
                  {run?.qc_remark && (
                    <p className="text-xs text-sky-200 mt-0.5 truncate">QC: {run.qc_remark}</p>
                  )}
                </div>

                {/* Exactly one obvious next action per row */}
                {!isDispatched && (
                  run ? (
                    <RunAdvanceControl
                      run={run}
                      dept={dept}
                      busy={busyId === run.id}
                      onAdvance={() => advanceRun(run)}
                    />
                  ) : (
                    <div className="shrink-0 flex items-center gap-2">
                      {canDeptManagePrintRuns(dept) && (
                        <button
                          onClick={() => startRunForSchedule(s)}
                          disabled={busyId === s.id}
                          className="text-xs px-3 py-1.5 rounded-lg bg-brand-primary text-white font-medium hover:bg-brand-primary/90 transition-colors disabled:opacity-40"
                        >
                          {busyId === s.id ? 'Starting…' : 'Start Production'}
                        </button>
                      )}
                      {dept.isSuperAdmin && (
                        <button
                          onClick={() => setOverrideSched(s)}
                          disabled={busyId === s.id}
                          title="Force-dispatch without a production run"
                          className="text-xs px-2 py-1.5 rounded-lg border border-white/10 text-[var(--glass-muted)] hover:bg-white/10 transition-colors disabled:opacity-40"
                        >
                          Override
                        </button>
                      )}
                    </div>
                  )
                )}
              </div>
            </div>
          );
        })}

        {/* Runs without a schedule (non-scheduled multi-run jobs / legacy) */}
        {orphanRuns.map((run) => {
          const isDone = run.status === 'dispatched';
          return (
            <div
              key={run.id}
              className={cn(
                'flex items-center justify-between gap-3 rounded-lg border px-4 py-3',
                isDone ? 'border-emerald-300/25 bg-emerald-400/10' : 'glass'
              )}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--glass-ink)]">
                  Run #{run.run_number}
                  <span className="ml-2 font-mono text-xs text-[var(--glass-muted)]">
                    {formatQty(run.qty_this_run)} labels
                  </span>
                </p>
                <p className="inline-flex items-center gap-1 text-xs text-[var(--glass-muted)] mt-0.5">
                  {isDone
                    ? <CheckCircle2 className="w-3 h-3 text-emerald-200 shrink-0" aria-hidden="true" />
                    : <RefreshCw className="w-3 h-3 text-sky-200 shrink-0" aria-hidden="true" />}
                  Stage: <strong className={isDone ? 'text-emerald-200' : 'text-[var(--glass-ink)]'}>
                    {RUN_STAGE_LABELS[run.current_stage]}
                  </strong>
                  {run.dispatched_at && (
                    <span className="ml-1 font-mono">{formatShortDate(run.dispatched_at)}</span>
                  )}
                </p>
                {run.notes && (
                  <p className="text-xs text-[var(--glass-muted)] mt-0.5 truncate">{run.notes}</p>
                )}
                {run.qc_remark && (
                  <p className="text-xs text-sky-200 mt-0.5 truncate">QC: {run.qc_remark}</p>
                )}
              </div>

              {!isDone && (
                <RunAdvanceControl
                  run={run}
                  dept={dept}
                  busy={busyId === run.id}
                  onAdvance={() => advanceRun(run)}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Totals */}
      <div className="bg-white/[0.06] border border-white/10 rounded-lg px-3 py-2 flex gap-6 text-xs font-mono mt-2">
        <span>Total: <strong>{formatQty(totalQty)}</strong></span>
        <span className="text-emerald-200">Dispatched: <strong>{formatQty(dispatchedQty)}</strong></span>
        <span className="text-amber-200">Remaining: <strong>{formatQty(remainingQty)}</strong></span>
      </div>

      {/* Scheduled job, next release not yet known */}
      {awaitingSchedule && (
        <div className="mt-2 bg-amber-400/10 border border-amber-300/25 rounded-lg px-3 py-2">
          <p className="inline-flex items-start gap-1.5 text-xs text-amber-200">
            <Clock className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
            <span>
              Next release not scheduled yet — {formatQty(remainingQty)} labels remaining.
              {dept.isSuperAdmin && ' Add it above as soon as the date is known.'}
            </span>
          </p>
        </div>
      )}

      {/* Non-scheduled job, between runs */}
      {awaitingNext && (
        <div className="flex items-center justify-between gap-3 mt-2 bg-amber-400/10 border border-amber-300/25 rounded-lg px-3 py-2">
          <p className="inline-flex items-center gap-1.5 text-xs text-amber-200">
            <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            Awaiting next print run — {formatQty(remainingQty)} labels remaining
          </p>
          {canStartNext && (
            <button
              onClick={() => setShowModal(true)}
              className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-brand-primary text-white font-medium hover:bg-brand-primary/90 transition-colors"
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

      {/* QC sign-off remark before advancing a run past QC */}
      {qcRun && (
        <PromptModal
          title={`Quality Check — Run #${qcRun.run_number}`}
          description="Leave blank for a clean pass. If filled, the remark will be visible to the client."
          label="QC Remark (optional)"
          kind="textarea"
          initialValue={qcRun.qc_remark ?? ''}
          confirmLabel="Save QC"
          placeholder="e.g. Minor colour variation within acceptable range…"
          onCancel={() => setQcRun(null)}
          onConfirm={(remark) => {
            const run = qcRun;
            setQcRun(null);
            advanceRun(run, remark);
          }}
        />
      )}

      {/* Admin override: force-dispatch a release without a production run */}
      {overrideSched && (
        <PromptModal
          title={`Override — Release ${overrideSched.release_number}`}
          description={`Mark this release dispatched without a production run. Planned quantity: ${formatQty(overrideSched.planned_qty)} labels.`}
          label="Actual quantity dispatched *"
          kind="number"
          required
          min={1}
          initialValue={String(overrideSched.planned_qty)}
          confirmLabel="Dispatch (override)"
          onCancel={() => setOverrideSched(null)}
          onConfirm={(qty) => {
            const sched = overrideSched;
            setOverrideSched(null);
            overrideDispatch(sched, qty);
          }}
        />
      )}
    </div>
  );
}

// ── Run advance control ───────────────────────────────────────
// The single action button for an in-production run: advance to the
// next per-run stage if the viewer's department owns it, otherwise a
// lock showing whose turn it is.

function RunAdvanceControl({
  run,
  dept,
  busy,
  onAdvance,
}: {
  run:       PrintRun;
  dept:      DeptPermissions;
  busy:      boolean;
  onAdvance: () => void;
}) {
  const nextStage = nextRunStage(run.current_stage);
  if (!nextStage) return null;

  const mayAdvance = canDeptSetRunStage(dept, nextStage);

  return mayAdvance ? (
    <button
      onClick={onAdvance}
      disabled={busy}
      className={cn(
        'shrink-0 text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors',
        nextStage === 'Dispatched'
          ? 'bg-emerald-400/15 border-emerald-300/30 text-emerald-200 hover:bg-emerald-400/25'
          : 'bg-white/[0.06] border-white/10 text-[var(--glass-ink)] hover:bg-white/10',
        'disabled:opacity-40'
      )}
    >
      {busy ? 'Saving…' : `→ ${RUN_STAGE_LABELS[nextStage]}`}
    </button>
  ) : (
    <span className="shrink-0 inline-flex items-center gap-1 text-xs text-[var(--glass-muted)]">
      <Lock className="w-3 h-3" aria-hidden="true" />
      Awaiting another department
    </span>
  );
}

// ── Add Next Release form ─────────────────────────────────────
// Admin-only inline form: the client confirmed the next release, record
// its date + quantity so Production can start it when the time comes.

function AddReleaseForm({
  jobId,
  onDone,
}: {
  jobId:  string;
  onDone: (added: boolean) => void;
}) {
  const [date,   setDate]   = useState('');
  const [qty,    setQty]    = useState('');
  const [notes,  setNotes]  = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    const plannedQty = Number(qty);
    if (!date || !plannedQty || plannedQty <= 0) {
      toast.error('Release date and a positive quantity are required');
      return;
    }
    setSaving(true);
    try {
      const res  = await fetch(`/api/jobs/${jobId}/schedules`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ planned_date: date, planned_qty: plannedQty, notes }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to add release');
        return;
      }
      toast.success(`Release ${data.schedule.release_number} scheduled`);
      onDone(true);
    } catch {
      toast.error('Network error. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="glass rounded-lg px-4 py-3 mb-2 flex flex-wrap items-end gap-3">
      <label className="text-xs text-[var(--glass-muted)]">
        Release date
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="block mt-1 bg-white/[0.06] border border-white/10 rounded-lg px-2 py-1.5 text-sm text-[var(--glass-ink)]"
        />
      </label>
      <label className="text-xs text-[var(--glass-muted)]">
        Quantity
        <input
          type="number"
          min={1}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder="e.g. 20000"
          className="block mt-1 w-28 bg-white/[0.06] border border-white/10 rounded-lg px-2 py-1.5 text-sm text-[var(--glass-ink)]"
        />
      </label>
      <label className="text-xs text-[var(--glass-muted)] flex-1 min-w-[140px]">
        Notes (optional)
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="block mt-1 w-full bg-white/[0.06] border border-white/10 rounded-lg px-2 py-1.5 text-sm text-[var(--glass-ink)]"
        />
      </label>
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={saving}
          className="text-xs px-3 py-1.5 rounded-lg bg-brand-primary text-white font-medium hover:bg-brand-primary/90 transition-colors disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Add Release'}
        </button>
        <button
          onClick={() => onDone(false)}
          className="text-xs px-2.5 py-1.5 rounded-lg border border-white/10 text-[var(--glass-muted)] hover:bg-white/10 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
