'use client';
// src/components/admin/MachineUtilisationReport.tsx
// What each machine actually did over a date range, from the started_at /
// completed_at stamps the board already records. Read-only report: no controls
// that change production data.
//
// "Utilisation" is printing time as a share of the whole window, wall clock
// included — nights and Sundays are in the denominator. It is a trend to
// compare machines and weeks against, not a target to hit.

import React, { useCallback, useEffect, useState } from 'react';
import { cn, formatQty } from '@/lib/utils';
import { formatDuration } from '@/lib/machineSpeed';
import type { MachineUtilisationReport as Report } from '@/lib/types';

export default function MachineUtilisationReport({ initial }: { initial: Report }) {
  const [report, setReport]   = useState<Report>(initial);
  const [from, setFrom]       = useState(initial.from);
  const [to, setTo]           = useState(initial.to);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [dirty, setDirty]     = useState(false);

  const load = useCallback(async (f: string, t: string) => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`/api/machines/analytics?from=${f}&to=${t}`);
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'Could not load the report');
        return;
      }
      setReport(body);
    } catch {
      setError('Network error. Try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Refetch when the range changes, skipping the first render — the server
  // already provided that exact window.
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => load(from, to), 250);
    return () => clearTimeout(timer);
  }, [from, to, dirty, load]);

  const totals = report.machines.reduce(
    (acc, m) => ({
      jobs:   acc.jobs   + m.jobs_completed,
      labels: acc.labels + m.labels_printed,
      ms:     acc.ms     + m.printing_ms,
    }),
    { jobs: 0, labels: 0, ms: 0 }
  );

  const dateInput =
    'bg-white/[0.06] border border-white/10 min-h-11 rounded-lg px-2 py-1 text-xs text-[var(--glass-ink)]';

  return (
    <div className="glass rounded-xl p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--glass-ink)]">
            Machine utilisation
          </h2>
          <p className="mt-0.5 text-xs text-[var(--glass-muted)]">
            Actual run times from every completed job on the machine board.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-[var(--glass-muted)]">
            From
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => { setFrom(e.target.value); setDirty(true); }}
              className={cn('mt-1 block', dateInput)}
            />
          </label>
          <label className="text-xs text-[var(--glass-muted)]">
            To
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => { setTo(e.target.value); setDirty(true); }}
              className={cn('mt-1 block', dateInput)}
            />
          </label>
        </div>
      </div>

      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-red-400/10 px-3 py-2 text-xs text-red-200">
          {error}
        </p>
      )}

      <div className="table-scroll-wrapper overflow-hidden rounded-xl border border-white/10">
        {loading && (
          <div className="relative h-1 overflow-hidden bg-brand-primary/20" role="status" aria-label="Loading report">
            <div className="loading-bar absolute inset-y-0 left-0 w-2/5 bg-brand-primary" />
          </div>
        )}

        <table className="w-full min-w-[860px] border-collapse text-sm">
          <caption className="sr-only">
            Machine utilisation from {report.from} to {report.to}
          </caption>
          <thead>
            <tr className="border-b border-white/12">
              {['Machine', 'Jobs done', 'Labels', 'Printing time', 'Avg run', 'Utilisation', 'Vs estimate'].map((col) => (
                <th
                  key={col}
                  scope="col"
                  className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--glass-muted)]"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.machines.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-[var(--glass-muted)]">
                  No machines on the board yet.
                </td>
              </tr>
            ) : (
              report.machines.map((m) => (
                <tr key={m.machine_id} className="border-b border-white/8 last:border-0">
                  <td className="px-4 py-3">
                    <span className="block font-medium text-[var(--glass-ink)]">{m.machine_name}</span>
                    <span className="block text-xs text-[var(--glass-muted)]">
                      {m.location ?? '—'}
                      {!m.is_active && <span className="ml-1 text-red-200">· not working</span>}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono tabular-nums text-[var(--glass-ink)]">
                    {m.jobs_completed}
                  </td>
                  <td className="px-4 py-3 font-mono tabular-nums text-[var(--glass-ink)]">
                    {m.labels_printed > 0 ? formatQty(m.labels_printed) : '—'}
                  </td>
                  <td className="px-4 py-3 font-mono tabular-nums text-[var(--glass-ink)]">
                    {m.printing_ms > 0 ? formatDuration(m.printing_ms) : '—'}
                  </td>
                  <td className="px-4 py-3 font-mono tabular-nums text-[var(--glass-muted)]">
                    {m.avg_run_ms ? formatDuration(m.avg_run_ms) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {m.utilisation_pct === null ? (
                      <span className="text-[var(--glass-muted)]">—</span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <span className="font-mono tabular-nums text-[var(--glass-ink)]">
                          {m.utilisation_pct}%
                        </span>
                        <span
                          className="h-1.5 w-16 overflow-hidden rounded-full bg-white/10"
                          role="img"
                          aria-label={`${m.utilisation_pct} percent of the period spent printing`}
                        >
                          <span
                            className="block h-full rounded-full bg-brand-primary"
                            style={{ width: `${Math.min(100, m.utilisation_pct)}%` }}
                          />
                        </span>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {m.estimated_runs === 0 ? (
                      <span className="text-xs text-[var(--glass-muted)]">no estimates</span>
                    ) : (
                      <span className="text-xs">
                        <span className="font-mono tabular-nums text-[var(--glass-ink)]">
                          {m.within_estimate}/{m.estimated_runs}
                        </span>
                        <span className="text-[var(--glass-muted)]"> on time</span>
                        {m.avg_deviation_pct !== null && (
                          <span
                            className={cn(
                              'ml-2 font-mono tabular-nums',
                              m.avg_deviation_pct > 0 ? 'text-amber-200' : 'text-emerald-200'
                            )}
                          >
                            {m.avg_deviation_pct > 0 ? '+' : ''}{m.avg_deviation_pct}%
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {report.machines.length > 0 && (
            <tfoot>
              <tr className="border-t border-white/12">
                <td className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-[var(--glass-muted)]">
                  All machines
                </td>
                <td className="px-4 py-3 font-mono tabular-nums text-[var(--glass-ink)]">{totals.jobs}</td>
                <td className="px-4 py-3 font-mono tabular-nums text-[var(--glass-ink)]">
                  {totals.labels > 0 ? formatQty(totals.labels) : '—'}
                </td>
                <td className="px-4 py-3 font-mono tabular-nums text-[var(--glass-ink)]">
                  {totals.ms > 0 ? formatDuration(totals.ms) : '—'}
                </td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="mt-3 text-xs text-[var(--glass-muted)]">
        Utilisation is printing time as a share of the whole period, including
        nights and holidays — useful for comparing machines and weeks, not as a
        target. &ldquo;Vs estimate&rdquo; counts runs that finished inside their
        estimated window, and the average by how much they ran over or under.
      </p>
    </div>
  );
}
