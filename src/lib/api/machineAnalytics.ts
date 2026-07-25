// src/lib/api/machineAnalytics.ts
// ============================================================
// Machine utilisation, derived from history the board already records.
// Every finished queue item carries started_at and completed_at, so actual run
// time, throughput and estimate accuracy need no new tracking — only reading
// what Start and Complete have been stamping all along.
//
// Read-only. Two queries regardless of the window or machine count.
// ============================================================

import { createAdminClient } from '@/lib/supabase/admin';
import type { Machine, MachineUtilisation, MachineUtilisationReport } from '@/lib/types';

/** 'YYYY-MM-DD' in IST — the plant's local day. */
export function istToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

/** N days before the IST day `iso`, as 'YYYY-MM-DD'. */
export function istDaysBefore(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

type DoneRow = {
  machine_id:   string;
  started_at:   string | null;
  completed_at: string | null;
  est_start_at: string | null;
  est_end_at:   string | null;
  jobs:         { label_qty: number | null } | null;
};

const span = (a: string | null, b: string | null): number | null => {
  if (!a || !b) return null;
  const ms = Date.parse(b) - Date.parse(a);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
};

/**
 * Per-machine utilisation between two IST days, both inclusive.
 * Throws on a malformed range so callers surface a 400 rather than silently
 * reporting on the wrong window.
 */
export async function getMachineUtilisation(
  from: string,
  to:   string
): Promise<MachineUtilisationReport> {
  if (!isDay(from) || !isDay(to)) {
    throw new Error('from and to must be YYYY-MM-DD');
  }
  if (from > to) {
    throw new Error('from must not be after to');
  }

  const admin = createAdminClient();

  // Exclusive upper bound = the day after `to`, so `to` is included in full.
  const after = new Date(`${to}T00:00:00Z`);
  after.setUTCDate(after.getUTCDate() + 1);
  const upper = after.toISOString().slice(0, 10);

  const [machinesRes, doneRes] = await Promise.all([
    admin.from('machines').select('*').eq('is_retired', false).order('created_at'),
    admin.from('machine_queue_items')
      .select('machine_id, started_at, completed_at, est_start_at, est_end_at, jobs(label_qty)')
      .eq('status', 'done')
      .gte('completed_at', `${from}T00:00:00+05:30`)
      .lt('completed_at', `${upper}T00:00:00+05:30`),
  ]);

  const machines = (machinesRes.data ?? []) as Machine[];
  const rows     = (doneRes.data ?? []) as unknown as DoneRow[];

  // Wall-clock length of the window — the denominator for utilisation.
  const windowMs =
    Date.parse(`${upper}T00:00:00+05:30`) - Date.parse(`${from}T00:00:00+05:30`);

  const machineStats: MachineUtilisation[] = machines.map((machine) => {
    const mine = rows.filter((r) => r.machine_id === machine.id);

    let printingMs   = 0;
    let runsTimed    = 0;
    let estimated    = 0;
    let within       = 0;
    let deviationSum = 0;

    for (const r of mine) {
      const actual = span(r.started_at, r.completed_at);
      if (actual !== null) {
        printingMs += actual;
        runsTimed  += 1;
      }

      const planned = span(r.est_start_at, r.est_end_at);
      if (actual !== null && planned !== null) {
        estimated += 1;
        if (actual <= planned) within += 1;
        deviationSum += ((actual - planned) / planned) * 100;
      }
    }

    const labels = mine.reduce((sum, r) => sum + (r.jobs?.label_qty ?? 0), 0);

    return {
      machine_id:      machine.id,
      machine_name:    machine.name,
      location:        machine.location,
      is_active:       machine.is_active,
      labels_per_hour: machine.labels_per_hour ?? null,
      jobs_completed:  mine.length,
      labels_printed:  labels,
      printing_ms:     printingMs,
      avg_run_ms:      runsTimed > 0 ? Math.round(printingMs / runsTimed) : null,
      utilisation_pct: windowMs > 0
        ? Math.round((printingMs / windowMs) * 1000) / 10   // one decimal
        : null,
      estimated_runs:    estimated,
      within_estimate:   within,
      avg_deviation_pct: estimated > 0
        ? Math.round((deviationSum / estimated) * 10) / 10
        : null,
    };
  });

  return { from, to, machines: machineStats };
}
