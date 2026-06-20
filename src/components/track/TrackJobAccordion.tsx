'use client';

import { useEffect, useRef, useState } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { registerGsap } from '@/lib/gsap/register';
import { useRouter } from 'next/navigation';
import { cn, formatQty, formatShortDate } from '@/lib/utils';
import { getProgressPercent, getVisibleStages } from '@/lib/constants/stages';
import type { ClientStatusLog, DispatchSchedule, Job, JobStageTimestamp, PrintRun } from '@/lib/types';
import type { Stage } from '@/lib/constants/stages';
import StagePipeline from './StagePipeline';
import ProgressBar from './ProgressBar';
import DeliveryCountdown from './DeliveryCountdown';
import StatusBanners from './StatusBanners';
import DispatchSummaryCard from './DispatchSummaryCard';
import ScheduledReleaseCard from './ScheduledReleaseCard';
import { Reveal } from '@/components/motion/Reveal';

registerGsap();

type TrackJobBundle = {
  job: Job;
  statusLogs: ClientStatusLog[];
  stageTimestamps: JobStageTimestamp[];
  schedules: DispatchSchedule[];
  printRuns: PrintRun[];
};

type Props = {
  poNumber: string;
  jobs: TrackJobBundle[];
  initialJobId?: string;
};

export default function TrackJobAccordion({ poNumber, jobs, initialJobId }: Props) {
  const router = useRouter();
  const firstJobId = jobs[0]?.job.id;
  const hasInitialJob = Boolean(initialJobId && jobs.some((bundle) => bundle.job.id === initialJobId));

  const [openJobId, setOpenJobId] = useState<string | undefined>(
    hasInitialJob
      ? initialJobId
      : jobs.length === 1
        ? firstJobId
        : undefined
  );

  useEffect(() => {
    const nextJobId = hasInitialJob
      ? initialJobId
      : jobs.length === 1
        ? firstJobId
        : undefined;

    if (nextJobId !== openJobId) {
      setOpenJobId(nextJobId);
    }
  }, [hasInitialJob, initialJobId, firstJobId, jobs.length, openJobId]);

  if (!jobs.length) return null;

  if (jobs.length === 1) {
    const singleBundle = jobs[0];
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Result for &ldquo;{poNumber}&rdquo;</h2>
            <p className="text-sm text-green-200">Single product order. Details are shown directly below.</p>
          </div>
          <a href="/track" className="text-sm text-green-200 hover:text-white shrink-0">
            ← Search again
          </a>
        </div>

        <div className="rounded-2xl border border-brand-accent/25 bg-white shadow-sm">
          <SingleJobDetail bundle={singleBundle} />
        </div>
      </div>
    );
  }

  function handleSelect(jobId: string) {
    // Toggle close when clicking the same open row.
    if (openJobId === jobId) {
      setOpenJobId(undefined);
      router.replace(`/track/${encodeURIComponent(poNumber)}`, { scroll: false });
      return;
    }

    // Open the selected job directly (GSAP animates the previous one closed).
    setOpenJobId(jobId);
    router.replace(`/track/${encodeURIComponent(poNumber)}?id=${jobId}`, { scroll: false });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Matching Jobs — &ldquo;{poNumber}&rdquo;</h2>
          <p className="text-sm text-green-200">Open one job at a time. Click any row to expand it smoothly.</p>
        </div>
        <a href="/track" className="text-sm text-green-200 hover:text-white shrink-0">
          ← Search again
        </a>
      </div>

      <div className="space-y-3">
        {jobs.map((bundle) => {
          const isOpen = bundle.job.id === openJobId;
          return (
            <article
              key={bundle.job.id}
              className={cn(
                'overflow-hidden rounded-2xl border bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)]',
                isOpen ? 'border-brand-accent/30 ring-1 ring-brand-accent/10' : 'border-brand-border'
              )}
            >
              <button
                type="button"
                onClick={() => handleSelect(bundle.job.id)}
                className={cn(
                  'w-full text-left px-5 py-4 flex items-start justify-between gap-4 transition-all duration-300',
                  isOpen ? 'bg-gradient-to-r from-brand-bg/40 to-white' : 'hover:bg-brand-bg/20 hover:shadow-[0_1px_0_rgba(0,0,0,0.02)]'
                )}
              >
                <div className="min-w-0">
                  <p className="font-mono text-xs text-brand-muted mb-0.5">{bundle.job.po_number}</p>
                  {bundle.job.pm_code && (
                    <p className="font-mono text-xs text-brand-muted mb-1">{bundle.job.pm_code}</p>
                  )}
                  <h3 className="text-base font-semibold text-brand-accent truncate">
                    {bundle.job.job_name ?? bundle.job.party}
                  </h3>
                  <p className="text-sm text-brand-muted truncate">{bundle.job.party}</p>
                </div>

                <div className="flex flex-col items-end gap-2 shrink-0">
                  <span className="text-xs px-2.5 py-1 rounded-full bg-brand-bg border border-brand-border text-brand-accent font-medium">
                    {bundle.job.status}
                  </span>
                  <span className="text-xs text-brand-muted">{bundle.job.job_type}</span>
                  <span className={cn('text-xs font-medium transition-transform duration-300', isOpen && 'rotate-180')}>
                    ▾
                  </span>
                </div>
              </button>

              <ExpandPanel open={isOpen}>
                <div className="px-5 pb-5 space-y-5">
                  <StatusBanners job={bundle.job} />

                  <Reveal onScroll>
                    <div className="bg-white border border-brand-border rounded-2xl p-5 shadow-[0_1px_0_rgba(0,0,0,0.02)]">
                      <div className="flex items-start justify-between gap-2 flex-wrap mb-3">
                        <div>
                          <p className="font-mono text-xs text-brand-muted mb-0.5">{bundle.job.po_number}</p>
                          {bundle.job.pm_code && (
                            <p className="font-mono text-xs text-brand-muted">{bundle.job.pm_code}</p>
                          )}
                          <h2 className="text-lg font-semibold text-brand-accent mt-1">
                            {bundle.job.job_name ?? bundle.job.party}
                          </h2>
                          <p className="text-sm text-brand-muted">{bundle.job.party}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          <StatusPill status={bundle.job.status} />
                          <span className="text-xs text-brand-muted">{bundle.job.job_type}</span>
                        </div>
                      </div>

                      <ProgressBar
                        percent={getProgressPercent(
                          bundle.stageTimestamps.map((t) => t.stage as Stage),
                          bundle.job.job_type
                        )}
                        status={bundle.job.status}
                      />

                      <DeliveryCountdown deliveryDate={bundle.job.delivery_date} />

                      {bundle.statusLogs[bundle.statusLogs.length - 1] && (
                        <p className="text-xs text-brand-muted mt-3 pt-3 border-t border-brand-border">
                          Last updated by{' '}
                          <strong className="font-medium">
                            {bundle.statusLogs[bundle.statusLogs.length - 1].department_display}
                          </strong>
                          {' · '}
                          {formatShortDate(bundle.statusLogs[bundle.statusLogs.length - 1].changed_at)}
                        </p>
                      )}
                    </div>
                  </Reveal>

                  <StagePipeline
                    job={bundle.job}
                    completedStages={bundle.stageTimestamps.map((t) => t.stage as Stage)}
                    statusLogs={bundle.statusLogs}
                    visibleStages={getVisibleStages(bundle.job.job_type)}
                    stageTimestamps={bundle.stageTimestamps}
                    printRuns={bundle.printRuns}
                  />

                  {(bundle.job.dispatched_qty ?? 0) > 0 && (
                    <Reveal onScroll>
                      <DispatchSummaryCard
                        total={bundle.job.label_qty}
                        dispatched={bundle.job.dispatched_qty}
                        remaining={bundle.job.remaining_qty}
                      />
                    </Reveal>
                  )}

                  {bundle.job.is_scheduled_release && bundle.schedules.length > 0 && (
                    <Reveal onScroll>
                      <ScheduledReleaseCard schedules={bundle.schedules} />
                    </Reveal>
                  )}

                  <Reveal onScroll>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: 'Total Ordered', value: formatQty(bundle.job.label_qty) },
                        { label: 'PO Date', value: formatShortDate(bundle.job.po_date) },
                        { label: 'Delivery Date', value: formatShortDate(bundle.job.delivery_date) },
                        {
                          label: 'Current Stage Since',
                          value: bundle.statusLogs[bundle.statusLogs.length - 1]
                            ? formatShortDate(bundle.statusLogs[bundle.statusLogs.length - 1].changed_at)
                            : '—',
                        },
                      ].map((item) => (
                        <div key={item.label} className="bg-white border border-brand-border rounded-xl p-3">
                          <p className="text-xs text-brand-muted mb-0.5">{item.label}</p>
                          <p className="text-sm font-medium text-brand-accent font-mono">{item.value}</p>
                        </div>
                      ))}
                    </div>
                  </Reveal>
                </div>
              </ExpandPanel>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function SingleJobDetail({ bundle }: { bundle: TrackJobBundle }) {
  const latestLog = bundle.statusLogs[bundle.statusLogs.length - 1];

  return (
    <div className="space-y-5 p-5">
      <StatusBanners job={bundle.job} />

      <Reveal onScroll>
        <div className="bg-white border border-brand-border rounded-2xl p-5 shadow-[0_1px_0_rgba(0,0,0,0.02)]">
          <div className="flex items-start justify-between gap-2 flex-wrap mb-3">
            <div>
              <p className="font-mono text-xs text-brand-muted mb-0.5">{bundle.job.po_number}</p>
              {bundle.job.pm_code && (
                <p className="font-mono text-xs text-brand-muted">{bundle.job.pm_code}</p>
              )}
              <h2 className="text-lg font-semibold text-brand-accent mt-1">
                {bundle.job.job_name ?? bundle.job.party}
              </h2>
              <p className="text-sm text-brand-muted">{bundle.job.party}</p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <StatusPill status={bundle.job.status} />
              <span className="text-xs text-brand-muted">{bundle.job.job_type}</span>
            </div>
          </div>

          <ProgressBar
            percent={getProgressPercent(
              bundle.stageTimestamps.map((t) => t.stage as Stage),
              bundle.job.job_type
            )}
            status={bundle.job.status}
          />

          <DeliveryCountdown deliveryDate={bundle.job.delivery_date} />

          {latestLog && (
            <p className="text-xs text-brand-muted mt-3 pt-3 border-t border-brand-border">
              Last updated by{' '}
              <strong className="font-medium">{latestLog.department_display}</strong>
              {' · '}
              {formatShortDate(latestLog.changed_at)}
            </p>
          )}
        </div>
      </Reveal>

      <StagePipeline
        job={bundle.job}
        completedStages={bundle.stageTimestamps.map((t) => t.stage as Stage)}
        statusLogs={bundle.statusLogs}
        visibleStages={getVisibleStages(bundle.job.job_type)}
        stageTimestamps={bundle.stageTimestamps}
        printRuns={bundle.printRuns}
      />

      {(bundle.job.dispatched_qty ?? 0) > 0 && (
        <Reveal onScroll>
          <DispatchSummaryCard
            total={bundle.job.label_qty}
            dispatched={bundle.job.dispatched_qty}
            remaining={bundle.job.remaining_qty}
          />
        </Reveal>
      )}

      {bundle.job.is_scheduled_release && bundle.schedules.length > 0 && (
        <Reveal onScroll>
          <ScheduledReleaseCard schedules={bundle.schedules} />
        </Reveal>
      )}

      <Reveal onScroll>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Total Ordered', value: formatQty(bundle.job.label_qty) },
            { label: 'PO Date', value: formatShortDate(bundle.job.po_date) },
            { label: 'Delivery Date', value: formatShortDate(bundle.job.delivery_date) },
            {
              label: 'Current Stage Since',
              value: latestLog ? formatShortDate(latestLog.changed_at) : '—',
            },
          ].map((item) => (
            <div key={item.label} className="bg-white border border-brand-border rounded-xl p-3">
              <p className="text-xs text-brand-muted mb-0.5">{item.label}</p>
              <p className="text-sm font-medium text-brand-accent font-mono">{item.value}</p>
            </div>
          ))}
        </div>
      </Reveal>
    </div>
  );
}

/** One-shot scale-pop flourish for Dispatched / PO Closed status pills. */
function StatusPill({ status }: { status: string }) {
  const pillRef = useRef<HTMLSpanElement>(null);
  const isSpecial = status === 'Dispatched' || status === 'PO Closed';

  useGSAP(() => {
    const el = pillRef.current;
    if (!el || !isSpecial) return;
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo(el, { scale: 0.85 }, { scale: 1, ease: 'back.out(2)', duration: 0.5 });
    });
    mm.add('(prefers-reduced-motion: reduce)', () => {
      gsap.set(el, { scale: 1 });
    });
    return () => mm.revert();
  }, { scope: pillRef });

  return (
    <span
      ref={pillRef}
      className="text-xs px-2.5 py-1 rounded-full bg-brand-bg border border-brand-border text-brand-accent font-medium"
    >
      {status}
    </span>
  );
}

function ExpandPanel({ open, children }: { open: boolean; children: React.ReactNode }) {
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
