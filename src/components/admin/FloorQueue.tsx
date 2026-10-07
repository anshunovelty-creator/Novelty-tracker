'use client';
// src/components/admin/FloorQueue.tsx
// "Ready to print" — the press floor's phone screen, shown above the jobs
// list on a phone for a department that sets In Printing. The job at the top
// of the queue opens as a card: pick the printing unit, tap Start printing.
// The rest wait below (tap one to bring it up), then what is running now.
// Which jobs qualify is lib/floorQueue.ts; the stage rules are the server's.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, formatJobCardNumber } from '@/lib/utils';
import { floorQueue } from '@/lib/floorQueue';
import { deliveryWords, istToday } from '@/lib/jobViews';
import { STAGE_DOT } from '@/lib/constants/statusColors';
import { JOBS_CHANGED_EVENT } from '@/lib/constants/events';
import { canDeptSetPrinting, canDeptSetStage, type DeptPermissions } from '@/lib/constants/departments';
import { usePrintingUnits } from '@/hooks/useReferenceData';
import { StateChip } from '@/components/ui/StateChip';
import { OnHoldModal } from './modals';
import type { Job, PrintingUnit } from '@/lib/types';

const METHOD_DOT: Record<string, string> = { Offset: '#DB2777', Flexo: '#047857' };
const NO_UNITS: PrintingUnit[] = [];

const ref = (j: Job) => formatJobCardNumber(j.job_card_number) ?? j.po_number;
const shortDate = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—';

export default function FloorQueue({ dept, initialJobs }: { dept: DeptPermissions; initialJobs: Job[] }) {
  const queryClient = useQueryClient();
  const { data: jobs = initialJobs } = useQuery({
    queryKey: ['jobs', 'floor'],
    queryFn: async () => {
      const res  = await fetch('/api/jobs');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load jobs');
      return data.jobs as Job[];
    },
    initialData: initialJobs,
    refetchInterval: 60_000,
  });
  const { data: units = NO_UNITS } = usePrintingUnits<PrintingUnit>();

  const { ready, running } = useMemo(
    () => floorQueue(jobs, (j) => canDeptSetStage(dept, 'In Printing', j.printing_method)),
    [jobs, dept],
  );

  const [pickedId, setPickedId] = useState<string | null>(null);
  const top = ready.find((j) => j.id === pickedId) ?? ready[0] ?? null;
  const waiting = ready.filter((j) => j !== top);

  const [unitByJob, setUnitByJob] = useState<Record<string, string | null>>({});
  const unitId = top ? (top.id in unitByJob ? unitByJob[top.id] : top.printing_unit_id) : null;
  const canPickUnit = canDeptSetPrinting(dept);

  const [busy, setBusy] = useState(false);
  const [holding, setHolding] = useState<Job | null>(null);

  function changed() {
    queryClient.invalidateQueries({ queryKey: ['jobs'] });
    window.dispatchEvent(new Event(JOBS_CHANGED_EVENT));
  }

  async function post(job: Job, body: Record<string, unknown>): Promise<boolean> {
    const res  = await fetch(`/api/jobs/${job.id}/status`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return true;
    toast.error(
      data.error === 'PREREQUISITE_MISSING' ? `Finish ${data.missing_stage} first — ask Admin if it was done offline.`
        : data.error ?? 'Could not update the job',
    );
    return false;
  }

  async function start(job: Job) {
    setBusy(true);
    try {
      // The unit first, so the job never shows In Printing on the wrong press.
      if (canPickUnit && unitId !== job.printing_unit_id) {
        const res = await fetch(`/api/jobs/${job.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ printing_unit_id: unitId }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          toast.error(data.error ?? 'Could not set the printing unit');
          return;
        }
      }
      if (await post(job, { new_status: 'In Printing' })) {
        toast.success(`${ref(job)} marked In Printing`);
        setPickedId(null);
        changed();
      }
    } catch {
      toast.error('Network error. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function hold(job: Job, remark: string) {
    setHolding(null);
    setBusy(true);
    try {
      if (await post(job, { new_status: 'On Hold', remark })) {
        toast.success(`${ref(job)} put on hold`);
        changed();
      }
    } catch {
      toast.error('Network error. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const today = istToday();
  const canHold = (j: Job) => canDeptSetStage(dept, 'On Hold', j.printing_method);

  return (
    <section aria-labelledby="floor-title" className="flex flex-col gap-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="floor-title" className="text-[22px] font-semibold tracking-[-0.01em] text-brand-ink">Ready to print</h2>
        <span className="font-mono text-xs text-brand-muted">
          {ready.length} waiting · {running.length} running
        </span>
      </div>

      {top ? (
        <article aria-label={ref(top)} className="flex flex-col gap-3.5 rounded-2xl border border-brand-border bg-white p-4 shadow-[0_8px_24px_rgba(12,42,32,0.08)]">
          <div className="flex items-center justify-between gap-2">
            <Link href={`/admin/jobs/${top.id}`} className="font-mono text-[15px] font-semibold text-brand-ink underline-offset-2 hover:underline">
              {ref(top)}
            </Link>
            <div className="flex items-center gap-2">
              <StateChip label={top.status} dot={STAGE_DOT[top.status]} />
              {top.urgent && (
                <span className="rounded-md bg-[#FEF2F2] px-1.5 py-0.5 font-mono text-xs font-semibold text-brand-danger">
                  {top.urgent_priority != null ? `P${top.urgent_priority}` : 'Urgent'}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[17px] font-semibold text-brand-ink">{top.party}</span>
            <span className="text-sm text-brand-muted">{top.job_name}</span>
          </div>
          <dl className="grid grid-cols-3 gap-2">
            <Fact label="Qty">{top.label_qty != null ? top.label_qty.toLocaleString('en-IN') : '—'}</Fact>
            <Fact label="Due">
              <span className={cn(deliveryWords(top, today).tone === 'late' && 'text-brand-danger')}>{shortDate(top.delivery_date)}</span>
            </Fact>
            <Fact label="Type">{top.job_type}</Fact>
          </dl>

          {units.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span id="floor-unit" className="text-[10px] font-medium uppercase tracking-[0.025em] text-brand-muted">Print on</span>
              <div role="radiogroup" aria-labelledby="floor-unit" className="flex gap-2">
                {units.map((u) => {
                  const on = u.id === unitId;
                  return (
                    <button
                      key={u.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      disabled={!canPickUnit || busy}
                      onClick={() => setUnitByJob((m) => ({ ...m, [top.id]: u.id }))}
                      className={cn(
                        'flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl text-sm text-brand-ink transition-colors disabled:cursor-not-allowed',
                        on ? 'border-2 border-brand-primary bg-[#F4F8F5] font-semibold' : 'border border-brand-border bg-white font-medium disabled:opacity-50',
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full font-mono text-[11px] text-white"
                        style={{ background: METHOD_DOT[u.printing_method] ?? '#64748B' }}
                      >
                        {u.name.replace(/\D/g, '') || u.name[0]}
                      </span>
                      {u.printing_method}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => start(top)}
            disabled={busy || (units.length > 0 && !unitId)}
            className="flex min-h-14 items-center justify-center gap-2.5 rounded-xl bg-brand-primary text-[17px] font-semibold text-white transition-colors hover:bg-brand-primary-hover disabled:opacity-50"
          >
            <Play className="h-5 w-5" aria-hidden="true" />
            {busy ? 'Saving…' : 'Start printing'}
          </button>
          {units.length > 0 && !unitId && <p className="-mt-2 text-center text-xs text-brand-muted">Pick a unit first.</p>}
          {canHold(top) && (
            <button
              type="button"
              onClick={() => setHolding(top)}
              disabled={busy}
              className="min-h-11 rounded-[10px] border border-[#FCD34D] bg-[#FFFBEB] text-sm font-semibold text-[#92400E] transition-colors hover:bg-[#FEF3C7] disabled:opacity-50"
            >
              Put on hold…
            </button>
          )}
        </article>
      ) : (
        <p className="rounded-2xl border border-dashed border-brand-border bg-white px-4 py-6 text-center text-sm text-brand-muted">
          Nothing is waiting for a press. Jobs show up here once the job card{' '}
          (and for a new job, the shade card) is done.
        </p>
      )}

      {waiting.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Also waiting">
          {waiting.map((j) => (
            <li key={j.id}>
              <button
                type="button"
                onClick={() => setPickedId(j.id)}
                className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-brand-border bg-white px-3.5 py-2.5 text-left transition-colors hover:bg-brand-surface-alt"
              >
                <QueueRow job={j} sub={<>{j.label_qty != null ? ` · ${j.label_qty.toLocaleString('en-IN')}` : ''} · due {shortDate(j.delivery_date)}</>} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {running.length > 0 && (
        <>
          <h3 className="mt-1 flex items-center gap-2 text-[13px] font-semibold text-brand-muted">
            <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full bg-[#10B981] shadow-[0_0_0_4px_rgba(16,185,129,0.18)]" />
            Running now
          </h3>
          <ul className="flex flex-col gap-2">
            {running.map((j) => (
              <li key={j.id}>
                <Link
                  href={`/admin/jobs/${j.id}`}
                  className="flex min-h-14 items-center gap-3 rounded-xl border border-brand-border bg-white px-3.5 py-2.5 transition-colors hover:bg-brand-surface-alt"
                >
                  <QueueRow job={j} sub={j.printing_units ? <> · {j.printing_units.name}</> : null} />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {holding && (
        <OnHoldModal job={holding} onCancel={() => setHolding(null)} onConfirm={(remark) => hold(holding, remark)} />
      )}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[10px] font-medium uppercase tracking-[0.025em] text-brand-muted">{label}</dt>
      <dd className="truncate font-mono text-[15px] font-semibold text-brand-ink">{children}</dd>
    </div>
  );
}

function QueueRow({ job, sub }: { job: Job; sub: React.ReactNode }) {
  return (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[15px] font-semibold text-brand-ink">{job.party}</span>
        <span className="truncate text-[13px] text-brand-muted">
          <span className="font-mono">{ref(job)}</span>{sub}
        </span>
      </span>
      <StateChip label={job.status} dot={STAGE_DOT[job.status]} className="shrink-0" />
    </>
  );
}
