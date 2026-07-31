'use client';
// src/components/track/ProductionRunsCard.tsx
// Production view for multi-run and scheduled-release orders:
//   • A shared header of the 3 job-level steps that happen once and are common
//     to every run — PO Received, Artwork Pending, Plate Status, Job Card Done.
//   • One column per print run showing every per-run step (see
//     constants/runStages.ts) with the date & time of each.
//   • Planned releases that haven't started production yet appear as their own
//     upcoming columns; the next planned date is called out, or "to be
//     confirmed" when the client hasn't fixed one yet.
//   • Every column is clickable — a detail panel expands below it with the
//     full step timeline, quantities, planned vs. actual dates and dispatch
//     info for that run or release.
//   • A totals footer: delivered so far vs. ordered, and what remains.

import { useRef, useState } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { registerGsap } from '@/lib/gsap/register';
import { cn, formatClientDate, formatQty, formatShortDate } from '@/lib/utils';
import { RUN_STAGES, RUN_STAGE_LABELS } from '@/lib/constants/runStages';
import type { DispatchSchedule, Job, JobStageTimestamp, PrintRun, RunStageTimestamp } from '@/lib/types';

registerGsap();

type Props = {
  job: Job;
  printRuns: PrintRun[];
  schedules: DispatchSchedule[];             // scheduled releases (dispatch_schedules)
  stageTimestamps: RunStageTimestamp[];      // per-run logs (print_run_stage_logs)
  commonStages: JobStageTimestamp[];         // job-level stages (job_stage_timestamps)
};

// What the detail panel is currently showing.
type Selected =
  | { kind: 'run'; run: PrintRun; schedule: DispatchSchedule | undefined }
  | { kind: 'schedule'; schedule: DispatchSchedule };

// Job-level steps shared by all runs — shown once, above the columns.
const COMMON_STAGES = ['PO Received', 'Artwork Pending', 'Plate Status', 'Job Card Done'] as const;

// Per-run process, in order — from the single source of truth.
const RUN_STEPS = RUN_STAGES.map((stage) => ({ stage, label: RUN_STAGE_LABELS[stage] }));

export default function ProductionRunsCard({ job, printRuns, schedules, stageTimestamps, commonStages }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Planned releases that no run has picked up yet (incl. admin-override dispatches)
  const unlinkedSchedules = schedules.filter(
    (s) => !printRuns.some((r) => r.schedule_id === s.id)
  );

  if (printRuns.length === 0 && unlinkedSchedules.length === 0 && !job.is_scheduled_release) {
    return null;
  }

  // run id → (stage → earliest timestamp)
  const tsByRun = new Map<string, Map<string, string>>();
  for (const log of stageTimestamps) {
    let byStage = tsByRun.get(log.print_run_id);
    if (!byStage) {
      byStage = new Map();
      tsByRun.set(log.print_run_id, byStage);
    }
    if (!byStage.has(log.stage)) byStage.set(log.stage, log.changed_at);
  }

  const commonTs     = new Map(commonStages.map((s) => [s.stage, s.completed_at]));
  const scheduleById = new Map(schedules.map((s) => [s.id, s]));

  const totalDispatched = job.total_qty_dispatched ?? 0;
  const remaining       = Math.max(0, (job.label_qty ?? 0) - totalDispatched);
  const activeRun       = printRuns.some((r) => r.status === 'in_progress');

  // The soonest release still waiting to start
  const nextRelease = unlinkedSchedules
    .filter((s) => s.status === 'Pending')
    .sort((a, b) => a.planned_date.localeCompare(b.planned_date))[0] ?? null;

  // Scheduled job with quantity left but no date confirmed for the next release
  const awaitingSchedule =
    job.is_scheduled_release && !nextRelease && !activeRun && remaining > 0;

  const selected: Selected | null = (() => {
    if (!selectedId) return null;
    const run = printRuns.find((r) => r.id === selectedId);
    if (run) {
      return { kind: 'run', run, schedule: run.schedule_id ? scheduleById.get(run.schedule_id) : undefined };
    }
    const schedule = unlinkedSchedules.find((s) => s.id === selectedId);
    return schedule ? { kind: 'schedule', schedule } : null;
  })();

  const toggle = (id: string) => setSelectedId((cur) => (cur === id ? null : id));

  return (
    <div className="glass rounded-2xl p-5">
      <h3 className="text-sm font-semibold text-[var(--glass-ink)] mb-4">Production Runs</h3>

      {/* Shared steps — common to every run */}
      <div className="mb-4 pb-4 border-b border-white/10">
        <p className="text-[10px] uppercase tracking-wide text-[var(--glass-muted)] mb-2">
          Common to all runs
        </p>
        <div className="flex flex-wrap gap-2">
          {COMMON_STAGES.map((stage) => {
            const ts = commonTs.get(stage) ?? null;
            return (
              <div
                key={stage}
                className="flex items-center gap-2 rounded-lg bg-white/[0.06] border border-white/10 px-3 py-2"
              >
                <span className={cn(
                  'block w-2.5 h-2.5 rounded-full shrink-0',
                  ts ? 'bg-emerald-400' : 'border border-white/25'
                )} />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-[var(--glass-ink)] leading-tight">{stage}</p>
                  <p className={cn(
                    'text-[10px] font-mono leading-tight',
                    ts ? 'text-emerald-200' : 'text-[var(--glass-muted)]'
                  )}>
                    {ts ? formatClientDate(ts) : 'Pending'}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Per-run columns — side by side, horizontal scroll on narrow screens.
          Each column is a button; clicking it expands the detail panel below. */}
      <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
        {printRuns.map((run) => {
          const byStage      = tsByRun.get(run.id) ?? new Map<string, string>();
          const isDispatched = run.status === 'dispatched';
          const reachedIdx   = RUN_STEPS.findIndex((s) => s.stage === run.current_stage);
          const schedule     = run.schedule_id ? scheduleById.get(run.schedule_id) : undefined;
          const isSelected   = selectedId === run.id;

          return (
            <button
              key={run.id}
              type="button"
              onClick={() => toggle(run.id)}
              aria-expanded={isSelected}
              className={cn(
                'shrink-0 w-[200px] glass rounded-xl p-4 border text-left transition-all duration-300 cursor-pointer',
                isSelected
                  ? 'border-sky-300/40 ring-1 ring-sky-300/30 bg-white/[0.05]'
                  : 'border-white/10 hover:border-white/25 hover:bg-white/[0.04]'
              )}
            >
              {/* Column header */}
              <div className="mb-3 pb-3 border-b border-white/10">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[var(--glass-ink)]">
                    {schedule ? `Release ${schedule.release_number}` : `Run ${run.run_number}`}
                  </p>
                  <span className={cn(
                    'text-[10px] font-medium px-2 py-0.5 rounded-full',
                    isDispatched ? 'bg-emerald-400/15 text-emerald-200' : 'bg-sky-400/15 text-sky-200'
                  )}>
                    {isDispatched ? 'Dispatched' : 'In Production'}
                  </span>
                </div>
                <p className="text-xs text-[var(--glass-muted)] font-mono mt-1">
                  {formatQty(run.qty_this_run)} labels
                </p>
                {schedule && !isDispatched && (
                  <p className="text-[10px] text-[var(--glass-muted)] font-mono mt-0.5">
                    planned {formatShortDate(schedule.planned_date)}
                  </p>
                )}
              </div>

              {/* Per-run steps with date + time on the right */}
              <div className="space-y-3">
                {RUN_STEPS.map(({ stage, label }, idx) => {
                  const ts        = byStage.get(stage) ?? null;
                  const isDone    = isDispatched || idx < reachedIdx;
                  const isCurrent = !isDispatched && idx === reachedIdx;

                  return (
                    <div key={stage} className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="shrink-0">
                          {isCurrent ? (
                            <span className="block w-2.5 h-2.5 rounded-full bg-sky-400 dot-pulse" />
                          ) : isDone ? (
                            <span className="block w-2.5 h-2.5 rounded-full bg-emerald-400" />
                          ) : (
                            <span className="block w-2.5 h-2.5 rounded-full border border-white/25" />
                          )}
                        </span>
                        <span className={cn(
                          'text-xs truncate',
                          isDone || isCurrent ? 'text-[var(--glass-ink)] font-medium' : 'text-[var(--glass-muted)]'
                        )}>
                          {label}
                        </span>
                      </div>
                      <span className={cn(
                        'text-[10px] font-mono text-right whitespace-nowrap shrink-0',
                        isDone ? 'text-emerald-200' : isCurrent ? 'text-sky-200' : 'text-[var(--glass-muted)]'
                      )}>
                        {ts ? formatClientDate(ts) : isCurrent ? 'In progress' : isDone ? '—' : 'Pending'}
                      </span>
                    </div>
                  );
                })}
              </div>

              <p className={cn(
                'text-[10px] mt-3 pt-2 border-t border-white/10 text-center',
                isSelected ? 'text-sky-200' : 'text-[var(--glass-muted)]'
              )}>
                {isSelected ? 'Hide details ▴' : 'View details ▾'}
              </p>
            </button>
          );
        })}

        {/* Upcoming / override-dispatched releases with no production run yet */}
        {unlinkedSchedules.map((s) => {
          const isDispatched = s.status === 'Dispatched';
          const isSelected   = selectedId === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => toggle(s.id)}
              aria-expanded={isSelected}
              className={cn(
                'shrink-0 w-[200px] glass rounded-xl p-4 border text-left transition-all duration-300 cursor-pointer',
                isSelected
                  ? 'ring-1 ring-sky-300/30 bg-white/[0.05]'
                  : 'hover:bg-white/[0.04]',
                isDispatched
                  ? (isSelected ? 'border-emerald-300/40' : 'border-emerald-300/25')
                  : (isSelected ? 'border-dashed border-sky-300/40' : 'border-dashed border-white/20 hover:border-white/30')
              )}
            >
              <div className="mb-3 pb-3 border-b border-white/10">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[var(--glass-ink)]">
                    Release {s.release_number}
                  </p>
                  <span className={cn(
                    'text-[10px] font-medium px-2 py-0.5 rounded-full',
                    isDispatched ? 'bg-emerald-400/15 text-emerald-200' : 'bg-white/10 text-white/70'
                  )}>
                    {isDispatched ? 'Dispatched' : 'Planned'}
                  </span>
                </div>
                <p className="text-xs text-[var(--glass-muted)] font-mono mt-1">
                  {formatQty(isDispatched ? (s.actual_qty ?? s.planned_qty) : s.planned_qty)} labels
                </p>
                <p className="text-[10px] text-[var(--glass-muted)] font-mono mt-0.5">
                  {isDispatched && s.actual_date
                    ? `dispatched ${formatShortDate(s.actual_date)}`
                    : `planned ${formatShortDate(s.planned_date)}`}
                </p>
              </div>

              <div className="space-y-3">
                {RUN_STEPS.map(({ stage, label }) => {
                  const isFinal = stage === 'Dispatched';
                  const done    = isDispatched;   // override dispatch: only the outcome is known
                  return (
                    <div key={stage} className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="shrink-0">
                          {done ? (
                            <span className="block w-2.5 h-2.5 rounded-full bg-emerald-400" />
                          ) : (
                            <span className="block w-2.5 h-2.5 rounded-full border border-white/25" />
                          )}
                        </span>
                        <span className={cn(
                          'text-xs truncate',
                          done ? 'text-[var(--glass-ink)] font-medium' : 'text-[var(--glass-muted)]'
                        )}>
                          {label}
                        </span>
                      </div>
                      <span className={cn(
                        'text-[10px] font-mono text-right whitespace-nowrap shrink-0',
                        done ? 'text-emerald-200' : 'text-[var(--glass-muted)]'
                      )}>
                        {done
                          ? (isFinal && s.actual_date ? formatClientDate(s.actual_date) : '—')
                          : 'Pending'}
                      </span>
                    </div>
                  );
                })}
              </div>

              <p className={cn(
                'text-[10px] mt-3 pt-2 border-t border-white/10 text-center',
                isSelected ? 'text-sky-200' : 'text-[var(--glass-muted)]'
              )}>
                {isSelected ? 'Hide details ▴' : 'View details ▾'}
              </p>
            </button>
          );
        })}
      </div>

      {/* Expanded detail for the selected run / release */}
      <DetailPanel selected={selected} tsByRun={tsByRun} />

      {/* Next release callout / awaiting date */}
      {nextRelease && (
        <p className="text-xs text-sky-200 bg-sky-400/10 border border-sky-300/20 rounded-lg px-3 py-2 mt-4">
          Next release: <strong className="font-mono">{formatShortDate(nextRelease.planned_date)}</strong>
          {' · '}
          <strong className="font-mono">{formatQty(nextRelease.planned_qty)}</strong> labels
        </p>
      )}
      {awaitingSchedule && (
        <p className="text-xs text-amber-200 bg-amber-400/10 border border-amber-300/20 rounded-lg px-3 py-2 mt-4">
          Next release date to be confirmed —{' '}
          <strong className="font-mono">{formatQty(remaining)}</strong> labels remaining.
        </p>
      )}

      {/* Totals footer — delivered vs. ordered (runs update total_qty_dispatched) */}
      {job.label_qty ? (
        <p className="text-sm text-[var(--glass-ink)] bg-white/10 rounded-lg px-3 py-2 mt-2">
          <strong className="font-mono">{formatQty(totalDispatched)}</strong> of{' '}
          <strong className="font-mono">{formatQty(job.label_qty)}</strong> delivered.{' '}
          <strong className="font-mono text-amber-200">{formatQty(remaining)}</strong>{' '}
          remaining.
        </p>
      ) : null}
    </div>
  );
}

// ── Detail panel ──────────────────────────────────────────────

function DetailPanel({ selected, tsByRun }: { selected: Selected | null; tsByRun: Map<string, Map<string, string>> }) {
  // Keep the last content mounted while the close animation runs.
  const lastSelected = useRef<Selected | null>(null);
  if (selected) lastSelected.current = selected;
  const shown = selected ?? lastSelected.current;

  return (
    <ExpandArea open={selected !== null}>
      {shown && (
        <div className="mt-3 rounded-xl border border-sky-300/25 bg-white/[0.04] p-4">
          {shown.kind === 'run'
            ? <RunDetail run={shown.run} schedule={shown.schedule} byStage={tsByRun.get(shown.run.id) ?? new Map()} />
            : <ScheduleDetail schedule={shown.schedule} />}
        </div>
      )}
    </ExpandArea>
  );
}

function RunDetail({ run, schedule, byStage }: {
  run: PrintRun;
  schedule: DispatchSchedule | undefined;
  byStage: Map<string, string>;
}) {
  const isDispatched = run.status === 'dispatched';
  const reachedIdx   = RUN_STEPS.findIndex((s) => s.stage === run.current_stage);
  const notes        = run.notes ?? schedule?.notes ?? null;

  const facts: { label: string; value: string }[] = [
    { label: 'Quantity this run', value: `${formatQty(run.qty_this_run)} labels` },
    ...(schedule ? [{ label: 'Planned date', value: formatShortDate(schedule.planned_date) }] : []),
    { label: 'Production started', value: formatClientDate(run.started_at) },
    { label: 'Dispatched', value: run.dispatched_at ? formatClientDate(run.dispatched_at) : 'Not yet' },
    ...(isDispatched && schedule?.actual_qty != null
      ? [{ label: 'Dispatched quantity', value: `${formatQty(schedule.actual_qty)} labels` }]
      : []),
    { label: 'Remaining after this run', value: `${formatQty(run.qty_remaining_after)} labels` },
  ];

  return (
    <div>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <p className="text-sm font-semibold text-[var(--glass-ink)]">
          {schedule ? `Release ${schedule.release_number} — details` : `Run ${run.run_number} — details`}
        </p>
        <span className={cn(
          'text-[10px] font-medium px-2 py-0.5 rounded-full',
          isDispatched ? 'bg-emerald-400/15 text-emerald-200' : 'bg-sky-400/15 text-sky-200'
        )}>
          {isDispatched ? 'Dispatched' : 'In Production'}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
        {facts.map((f) => (
          <div key={f.label} className="rounded-lg bg-white/[0.06] border border-white/10 px-3 py-2">
            <p className="text-[10px] text-[var(--glass-muted)] mb-0.5">{f.label}</p>
            <p className="text-xs font-medium text-[var(--glass-ink)] font-mono">{f.value}</p>
          </div>
        ))}
      </div>

      <p className="text-[10px] uppercase tracking-wide text-[var(--glass-muted)] mb-2">
        Step timeline
      </p>
      <div className="space-y-2.5">
        {RUN_STEPS.map(({ stage, label }, idx) => {
          const ts        = byStage.get(stage) ?? null;
          const isDone    = isDispatched || idx < reachedIdx;
          const isCurrent = !isDispatched && idx === reachedIdx;

          return (
            <div key={stage} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="shrink-0">
                  {isCurrent ? (
                    <span className="block w-2.5 h-2.5 rounded-full bg-sky-400 dot-pulse" />
                  ) : isDone ? (
                    <span className="block w-2.5 h-2.5 rounded-full bg-emerald-400" />
                  ) : (
                    <span className="block w-2.5 h-2.5 rounded-full border border-white/25" />
                  )}
                </span>
                <span className={cn(
                  'text-xs',
                  isDone || isCurrent ? 'text-[var(--glass-ink)] font-medium' : 'text-[var(--glass-muted)]'
                )}>
                  {label}
                </span>
              </div>
              <span className={cn(
                'text-[11px] font-mono text-right whitespace-nowrap shrink-0',
                isDone ? 'text-emerald-200' : isCurrent ? 'text-sky-200' : 'text-[var(--glass-muted)]'
              )}>
                {ts ? formatClientDate(ts) : isCurrent ? 'In progress' : isDone ? 'Completed' : 'Pending'}
              </span>
            </div>
          );
        })}
      </div>

      {run.qc_remark && (
        <p className="text-xs text-sky-200 bg-sky-400/10 border border-sky-300/20 rounded-lg px-3 py-2 mt-4">
          QC note: {run.qc_remark}
        </p>
      )}

      {notes && (
        <p className="text-xs text-[var(--glass-muted)] mt-4 pt-3 border-t border-white/10">
          <span className="text-[var(--glass-ink)] font-medium">Notes:</span> {notes}
        </p>
      )}
    </div>
  );
}

function ScheduleDetail({ schedule }: { schedule: DispatchSchedule }) {
  const isDispatched = schedule.status === 'Dispatched';

  const facts: { label: string; value: string }[] = [
    { label: 'Planned quantity', value: `${formatQty(schedule.planned_qty)} labels` },
    { label: 'Planned date', value: formatShortDate(schedule.planned_date) },
    ...(isDispatched
      ? [
          { label: 'Dispatched quantity', value: `${formatQty(schedule.actual_qty ?? schedule.planned_qty)} labels` },
          { label: 'Dispatched on', value: schedule.actual_date ? formatClientDate(schedule.actual_date) : '—' },
        ]
      : []),
  ];

  return (
    <div>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <p className="text-sm font-semibold text-[var(--glass-ink)]">
          Release {schedule.release_number} — details
        </p>
        <span className={cn(
          'text-[10px] font-medium px-2 py-0.5 rounded-full',
          isDispatched ? 'bg-emerald-400/15 text-emerald-200' : 'bg-white/10 text-white/70'
        )}>
          {isDispatched ? 'Dispatched' : 'Planned'}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
        {facts.map((f) => (
          <div key={f.label} className="rounded-lg bg-white/[0.06] border border-white/10 px-3 py-2">
            <p className="text-[10px] text-[var(--glass-muted)] mb-0.5">{f.label}</p>
            <p className="text-xs font-medium text-[var(--glass-ink)] font-mono">{f.value}</p>
          </div>
        ))}
      </div>

      <p className="text-xs text-[var(--glass-muted)]">
        {isDispatched
          ? 'This release was dispatched directly, so its step-by-step production timing was not tracked.'
          : 'Production for this release has not started yet — the step timeline will appear here once printing begins.'}
      </p>

      {schedule.notes && (
        <p className="text-xs text-[var(--glass-muted)] mt-3 pt-3 border-t border-white/10">
          <span className="text-[var(--glass-ink)] font-medium">Notes:</span> {schedule.notes}
        </p>
      )}
    </div>
  );
}

/** GSAP height/opacity expander — same motion as the track accordion panels. */
function ExpandArea({ open, children }: { open: boolean; children: React.ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const el = wrap.current;
    if (!el) return;
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.to(el, { height: open ? 'auto' : 0, opacity: open ? 1 : 0, duration: 0.4, ease: 'power2.inOut', overwrite: 'auto' });
    });
    mm.add('(prefers-reduced-motion: reduce)', () => {
      gsap.set(el, { height: open ? 'auto' : 0, opacity: open ? 1 : 0 });
    });
    return () => mm.revert();
  }, { dependencies: [open], scope: wrap });
  return <div ref={wrap} style={{ height: 0, opacity: 0, overflow: 'hidden' }}>{children}</div>;
}
