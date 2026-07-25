'use client';
// src/components/display/MachineDisplay.tsx
// Read-only wall display for ONE machine, projected in its production room.
//   • Machine state, the job printing right now, and the queue behind it.
//   • No controls, no navigation, no mutations — a readout, nothing else.
//   • Fits one screen exactly and never scrolls — nobody scrolls a projection.
//     Type scales on min(vw, vh) so a wide-but-short window shrinks text
//     instead of pushing the footer off the bottom.
//   • Refreshes every 20 s; keeps the last good board on a network hiccup and
//     says so rather than passing stale data off as live.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { Maximize2, Minimize2 } from 'lucide-react';
import { cn, formatQty } from '@/lib/utils';
import type { MachineDisplayData, MachineDisplayItem } from '@/lib/types';

// 2 s reads as instant on the floor while staying cheap: one request every 2 s
// per screen. Going to ~50 ms would mean 20 requests/second per screen — each
// one 3 Postgres queries plus a token check — which is thousands of queries a
// minute for a board that changes a few times an hour. Not worth it; see the
// Realtime note in the PR/handover if sub-second is ever needed.
const POLL_MS  = 2_000;
// Past this much silence the board is no longer trustworthy as "live". At a 2 s
// cadence that is ~7 missed polls — tight enough that a dead network shows up
// on the wall quickly instead of a frozen board looking current.
const STALE_MS = 15_000;
// Rows that fit whole on a 16:9 screen without the last one being sliced in
// half; the remainder collapses into a "+N more" line. Four is deliberate —
// a clipped row on a wall display reads as a broken page.
const QUEUE_VISIBLE = 4;

const fmtTime = (iso: string | null) =>
  iso ? format(new Date(iso), 'h:mm aa') : '—';

const fmtDay = (iso: string | null) =>
  iso ? format(new Date(iso), 'dd MMM') : '—';

/**
 * Everything on a payload that can actually change the picture. Excludes
 * server_time, which differs on every response and would defeat the check.
 */
const shapeOf = (d: MachineDisplayData) =>
  JSON.stringify([d.machine, d.printing, d.queued, d.completed_today]);

/** "2h 14m" · "14m" · "48s" — coarse on purpose, it is read from metres away. */
function fmtDuration(ms: number): string {
  const safe  = ms < 0 ? 0 : ms;
  const mins  = Math.floor(safe / 60_000);
  const hours = Math.floor(mins / 60);
  if (mins < 1)  return `${Math.floor(safe / 1000)}s`;
  if (hours < 1) return `${mins}m`;
  return `${hours}h ${mins % 60}m`;
}

export default function MachineDisplay({
  initial,
  controlled = false,
}: {
  initial: MachineDisplayData;
  /**
   * true = the parent owns the data and refreshes it (the rotating supervisor
   * screen, which fetches every machine in one request). This component then
   * renders `initial` directly and does not poll, so the two never duplicate
   * each other's traffic.
   */
  controlled?: boolean;
}) {
  const [stateData, setData] = useState<MachineDisplayData>(initial);
  const data = controlled ? initial : stateData;
  const [now, setNow]       = useState<number | null>(null);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [isFull, setIsFull] = useState(false);

  // Difference between this screen's clock and the server's. Room PCs and TV
  // browsers drift; every elapsed figure is computed server-relative instead.
  const skewRef = useRef(0);
  // At a 2 s cadence a slow query must not let requests pile up on top of
  // each other, so only one is ever in flight.
  const inFlightRef = useRef(false);
  // Last payload with server_time stripped. Comparing against it lets an
  // unchanged board skip setState entirely — the queue only changes a few times
  // an hour, so almost every poll is a no-op and shouldn't re-render the tree.
  const lastShapeRef = useRef<string>('');

  const machineId = initial.machine.id;

  const load = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const res = await fetch(`/api/machines/${machineId}/display`, { cache: 'no-store' });
      if (!res.ok) return;                     // 401/404 — keep the last good board
      const fresh: MachineDisplayData = await res.json();
      skewRef.current = Date.now() - new Date(fresh.server_time).getTime();

      const shapeKey = shapeOf(fresh);
      if (shapeKey !== lastShapeRef.current) {
        lastShapeRef.current = shapeKey;
        setData(fresh);
      }
      setLastOk(Date.now());
    } catch {
      // Network hiccup on the shop floor — the staleness notice covers it.
    } finally {
      inFlightRef.current = false;
    }
  }, [machineId]);

  // Clock + elapsed counters. Kept out of the first render so server and client
  // markup match, then ticking every second.
  useEffect(() => {
    skewRef.current  = Date.now() - new Date(initial.server_time).getTime();
    // Seed the comparison with what the server already rendered, so an
    // unchanged first poll doesn't trigger a pointless re-render.
    lastShapeRef.current = shapeOf(initial);
    setNow(Date.now());
    setLastOk(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [initial]);

  // A room screen is always visible, but this page also gets opened on laptops
  // from the dashboard link. Don't poll a backgrounded tab every 2 s; catch up
  // the moment it comes back into view.
  useEffect(() => {
    if (controlled) return;   // the parent refreshes us
    const tick = () => {
      if (document.visibilityState === 'visible') load();
    };
    const t = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [load, controlled]);

  // Reflect real fullscreen state — Escape and F11 bypass our own button.
  useEffect(() => {
    const sync = () => setIsFull(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }

  const { machine, printing, queued, completed_today } = data;

  // Server-relative "now": null until mounted, so nothing time-derived renders
  // during hydration.
  const serverNow = now === null ? null : now - skewRef.current;
  const isStale   = now !== null && lastOk !== null && now - lastOk > STALE_MS;

  const state: 'printing' | 'idle' | 'fault' =
    !machine.is_active ? 'fault' : printing ? 'printing' : 'idle';

  // One locked screen from lg up (the projector case). Narrower than that the
  // panels stack, so allow normal scrolling instead of clipping them.
  return (
    <div className="flex min-h-[100dvh] flex-col gap-[clamp(0.5rem,1.5vh,1.75rem)] p-[clamp(0.75rem,min(2vw,3vh),2.5rem)] lg:h-[100dvh] lg:min-h-0 lg:overflow-hidden">
      {/* ── Header: which machine, and is it running ── */}
      <header className="flex shrink-0 items-start justify-between gap-6">
        <div className="min-w-0">
          <h1 className="text-[clamp(1.5rem,min(3.4vw,6.5vh),3.75rem)] font-semibold leading-none tracking-tight text-[var(--glass-ink)]">
            {machine.name}
          </h1>
          {machine.location && (
            <p className="mt-[0.4em] text-[clamp(0.8rem,min(1.2vw,2.4vh),1.5rem)] text-[var(--glass-muted)]">
              {machine.location}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-[clamp(0.5rem,1vw,1.25rem)]">
          <StatePill state={state} />
          <time
            className="font-mono tabular-nums text-[clamp(1rem,min(2vw,4vh),2.5rem)] text-[var(--glass-ink)]"
            suppressHydrationWarning
          >
            {serverNow === null ? '' : format(new Date(serverNow), 'h:mm aa')}
          </time>
          <button
            onClick={toggleFullscreen}
            aria-label={isFull ? 'Exit fullscreen' : 'Go fullscreen'}
            title={isFull ? 'Exit fullscreen' : 'Go fullscreen'}
            className="rounded-lg border border-white/10 p-2 text-[var(--glass-muted)] opacity-25 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60 motion-reduce:transition-none"
          >
            {isFull
              ? <Minimize2 className="h-5 w-5" aria-hidden="true" />
              : <Maximize2 className="h-5 w-5" aria-hidden="true" />}
          </button>
        </div>
      </header>

      {/* ── Body: now printing (dominant) + the queue ── */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-[clamp(0.75rem,1.5vw,1.75rem)] lg:grid-cols-5">
        <section
          aria-label="Now printing"
          className={cn(
            'flex flex-col justify-center rounded-2xl border p-[clamp(0.875rem,min(2.5vw,4vh),3rem)] lg:col-span-3',
            state === 'printing' && 'border-sky-300/30 bg-sky-400/10',
            state === 'idle'     && 'glass border-white/10',
            state === 'fault'    && 'border-red-300/30 bg-red-400/[0.08]'
          )}
        >
          {state === 'printing' && printing
            ? <NowPrinting item={printing} serverNow={serverNow} />
            : <NotPrinting state={state === 'fault' ? 'fault' : 'idle'} />}
        </section>

        <section
          aria-label="Queue"
          className="glass flex min-h-0 flex-col rounded-2xl border border-white/10 p-[clamp(0.875rem,min(1.75vw,3vh),2rem)] lg:col-span-2"
        >
          <div className="mb-[clamp(0.375rem,1vh,1rem)] flex shrink-0 items-baseline justify-between gap-3">
            <h2 className="text-[clamp(0.65rem,min(1vw,1.9vh),1.125rem)] font-medium uppercase tracking-[0.18em] text-[var(--glass-muted)]">
              Up next
            </h2>
            <span className="font-mono tabular-nums text-[clamp(0.8rem,min(1.4vw,2.8vh),1.75rem)] text-[var(--glass-ink)]">
              {queued.length}
            </span>
          </div>

          {queued.length === 0 ? (
            <p className="text-[clamp(0.8rem,min(1.3vw,2.6vh),1.5rem)] text-[var(--glass-muted)]">
              Nothing queued.
            </p>
          ) : (
            <ol className="flex min-h-0 flex-1 flex-col gap-[clamp(0.3rem,0.8vh,0.875rem)] lg:overflow-hidden">
              {queued.slice(0, QUEUE_VISIBLE).map((item, idx) => (
                <QueueRow key={item.id} item={item} index={idx} />
              ))}
              {queued.length > QUEUE_VISIBLE && (
                <li className="shrink-0 pt-[0.4em] text-[clamp(0.7rem,min(1.1vw,2.1vh),1.25rem)] text-[var(--glass-muted)]">
                  + {queued.length - QUEUE_VISIBLE} more in queue
                </li>
              )}
            </ol>
          )}
        </section>
      </div>

      {/* ── Footer: shift tally + is this board actually live ── */}
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-1 text-[clamp(0.7rem,min(1.1vw,2vh),1.25rem)] text-[var(--glass-muted)]">
        <p>
          Completed today{' '}
          <span className="font-mono tabular-nums text-[var(--glass-ink)]">
            {completed_today.count}
          </span>
          {completed_today.labels > 0 && (
            <>
              {' · '}
              <span className="font-mono tabular-nums text-[var(--glass-ink)]">
                {formatQty(completed_today.labels)}
              </span>{' '}
              labels
            </>
          )}
        </p>

        <p className="flex items-center gap-2" role="status" aria-live="polite">
          <span
            className={cn(
              'inline-block h-2 w-2 rounded-full',
              isStale ? 'bg-amber-300' : 'animate-pulse bg-emerald-300'
            )}
            aria-hidden="true"
          />
          {isStale ? 'Reconnecting — last update ' : 'Live · updated '}
          <span className="font-mono tabular-nums" suppressHydrationWarning>
            {lastOk === null ? '' : format(new Date(lastOk), 'h:mm:ss aa')}
          </span>
        </p>
      </footer>
    </div>
  );
}

// ── Machine state pill ────────────────────────────────────────

function StatePill({ state }: { state: 'printing' | 'idle' | 'fault' }) {
  const copy = { printing: 'Printing', idle: 'Idle', fault: 'Not working' }[state];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-[0.5em] rounded-full px-[0.9em] py-[0.35em] text-[clamp(0.72rem,min(1.25vw,2.4vh),1.5rem)] font-medium',
        state === 'printing' && 'bg-sky-400/15 text-sky-200',
        state === 'idle'     && 'bg-white/10 text-[var(--glass-muted)]',
        state === 'fault'    && 'bg-red-400/15 text-red-200'
      )}
    >
      <span
        className={cn(
          'inline-block h-[0.45em] w-[0.45em] rounded-full',
          state === 'printing' && 'animate-pulse bg-sky-300',
          state === 'idle'     && 'bg-current',
          state === 'fault'    && 'bg-red-300'
        )}
        aria-hidden="true"
      />
      {copy}
    </span>
  );
}

// ── The job on the machine right now ──────────────────────────

function NowPrinting({
  item,
  serverNow,
}: {
  item:      MachineDisplayItem;
  serverNow: number | null;
}) {
  const job     = item.jobs;
  const startMs = item.started_at ? new Date(item.started_at).getTime() : null;
  const endMs   = item.est_end_at ? new Date(item.est_end_at).getTime() : null;

  const elapsed = serverNow !== null && startMs !== null ? serverNow - startMs : null;

  // Progress against Production's own estimate — a reference, not a promise.
  let percent: number | null = null;
  let overBy:  number | null = null;
  if (serverNow !== null && startMs !== null && endMs !== null && endMs > startMs) {
    const raw = ((serverNow - startMs) / (endMs - startMs)) * 100;
    percent = Math.max(0, Math.min(100, raw));
    if (raw > 100) overBy = serverNow - endMs;
  }

  return (
    <>
      <p className="flex items-center gap-[0.6em] text-[clamp(0.65rem,min(1vw,1.9vh),1.125rem)] font-medium uppercase tracking-[0.18em] text-sky-200">
        <span className="inline-block h-[0.5em] w-[0.5em] animate-pulse rounded-full bg-sky-300" aria-hidden="true" />
        Now printing
        {job?.urgent && (
          <span className="rounded-full bg-red-400/20 px-[0.7em] py-[0.2em] tracking-[0.12em] text-red-200">
            Urgent
          </span>
        )}
      </p>

      <p className="mt-[0.3em] font-mono text-[clamp(1.75rem,min(6vw,11.5vh),6.5rem)] font-medium leading-none text-[var(--glass-ink)]">
        {job?.po_number ?? '—'}
      </p>

      {job?.job_name && (
        <p className="mt-[0.35em] text-[clamp(1rem,min(2.2vw,4.2vh),2.5rem)] leading-tight text-[var(--glass-ink)]">
          {job.job_name}
        </p>
      )}

      {job?.party && (
        <p className="mt-[0.2em] text-[clamp(0.8rem,min(1.4vw,2.7vh),1.75rem)] text-[var(--glass-muted)]">
          {job.party}
        </p>
      )}

      <dl className="mt-[0.9em] flex flex-wrap gap-x-[clamp(1rem,2.5vw,3rem)] gap-y-[0.4em] text-[clamp(0.78rem,min(1.3vw,2.5vh),1.625rem)]">
        <div>
          <dt className="text-[var(--glass-muted)]">Quantity</dt>
          <dd className="font-mono tabular-nums text-[var(--glass-ink)]">
            {formatQty(job?.label_qty)}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--glass-muted)]">Started</dt>
          <dd className="font-mono tabular-nums text-[var(--glass-ink)]">
            {fmtTime(item.started_at)}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--glass-muted)]">Running for</dt>
          <dd className="font-mono tabular-nums text-[var(--glass-ink)]" suppressHydrationWarning>
            {elapsed === null ? '—' : fmtDuration(elapsed)}
          </dd>
        </div>
        {item.est_end_at && (
          <div>
            <dt className="text-[var(--glass-muted)]">Est. finish</dt>
            <dd
              className={cn(
                'font-mono tabular-nums',
                overBy !== null ? 'text-amber-200' : 'text-[var(--glass-ink)]'
              )}
            >
              {fmtTime(item.est_end_at)}
            </dd>
          </div>
        )}
      </dl>

      {percent !== null && (
        <div className="mt-[0.9em]">
          <div
            className="h-[clamp(0.4rem,0.6vw,0.75rem)] w-full overflow-hidden rounded-full bg-white/10"
            role="progressbar"
            aria-valuenow={Math.round(percent)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Progress against estimated finish"
          >
            <div
              className={cn(
                'h-full rounded-full transition-[width] duration-1000 ease-linear motion-reduce:transition-none',
                overBy !== null ? 'bg-amber-300' : 'bg-sky-300'
              )}
              style={{ width: `${percent}%` }}
            />
          </div>
          {overBy !== null && (
            <p
              className="mt-[0.4em] text-[clamp(0.7rem,min(1.1vw,2.1vh),1.25rem)] text-amber-200"
              suppressHydrationWarning
            >
              Past estimate by {fmtDuration(overBy)}
            </p>
          )}
        </div>
      )}
    </>
  );
}

// ── Idle / faulty ─────────────────────────────────────────────

function NotPrinting({ state }: { state: 'idle' | 'fault' }) {
  return (
    <div className="text-center">
      <p
        className={cn(
          'text-[clamp(1.75rem,min(5vw,9.5vh),5rem)] font-semibold leading-none tracking-tight',
          state === 'fault' ? 'text-red-200' : 'text-[var(--glass-ink)]'
        )}
      >
        {state === 'fault' ? 'Not working' : 'Idle'}
      </p>
      <p className="mt-[0.5em] text-[clamp(0.8rem,min(1.5vw,2.9vh),1.75rem)] text-[var(--glass-muted)]">
        {state === 'fault'
          ? 'This machine is marked as not working.'
          : 'Nothing printing right now.'}
      </p>
    </div>
  );
}

// ── One queued job ────────────────────────────────────────────

function QueueRow({ item, index }: { item: MachineDisplayItem; index: number }) {
  const job = item.jobs;
  return (
    <li className="flex items-start gap-[clamp(0.5rem,1vw,1rem)] rounded-xl border border-white/10 bg-white/[0.05] px-[clamp(0.625rem,1.1vw,1.25rem)] py-[clamp(0.4rem,0.9vh,1rem)]">
      <span className="mt-[0.1em] flex h-[1.9em] w-[1.9em] shrink-0 items-center justify-center rounded-full bg-white/10 font-mono tabular-nums text-[clamp(0.68rem,min(1.05vw,2vh),1.25rem)] text-[var(--glass-muted)]">
        {index + 1}
      </span>

      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-[0.6em] gap-y-[0.2em]">
          <span className="font-mono text-[clamp(0.9rem,min(1.7vw,3.1vh),2rem)] font-medium text-[var(--glass-ink)]">
            {job?.po_number ?? '—'}
          </span>
          {job?.urgent && (
            <span className="rounded-full bg-red-400/20 px-[0.6em] py-[0.15em] text-[clamp(0.6rem,0.85vw,0.9rem)] font-medium uppercase tracking-[0.1em] text-red-200">
              Urgent
            </span>
          )}
        </p>

        {(job?.job_name || job?.party) && (
          <p className="truncate text-[clamp(0.72rem,min(1.15vw,2.2vh),1.375rem)] text-[var(--glass-ink)]">
            {job?.job_name ?? job?.party}
          </p>
        )}

        <p className="font-mono tabular-nums text-[clamp(0.65rem,min(1vw,1.85vh),1.125rem)] text-[var(--glass-muted)]">
          {job?.label_qty != null && `${formatQty(job.label_qty)} · `}
          {item.est_start_at ? `from ${fmtTime(item.est_start_at)}` : 'no estimate'}
          {job?.delivery_date && ` · due ${fmtDay(job.delivery_date)}`}
        </p>
      </div>
    </li>
  );
}
