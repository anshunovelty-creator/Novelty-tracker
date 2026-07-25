// src/lib/machineSpeed.ts
// ============================================================
// Estimated run length from a machine's throughput.
// Lives here because both sides need the same answer: the queue API fills in
// est_end_at when Production leaves it blank, and the machine board shows the
// projected finish before they submit. Two copies of this arithmetic would
// eventually disagree.
// ============================================================

/** Milliseconds a run of `labelQty` takes on a machine doing `labelsPerHour`. */
export function runDurationMs(
  labelQty:      number | null | undefined,
  labelsPerHour: number | null | undefined
): number | null {
  if (!labelQty || !labelsPerHour) return null;
  if (labelQty <= 0 || labelsPerHour <= 0) return null;
  return Math.round((labelQty / labelsPerHour) * 3_600_000);
}

/**
 * Projected finish as an ISO string, or null when the machine has no rate or
 * the job has no quantity. `startIso` is the run's start (estimated or actual).
 */
export function estimateFinishIso(
  startIso:      string | null | undefined,
  labelQty:      number | null | undefined,
  labelsPerHour: number | null | undefined
): string | null {
  if (!startIso) return null;
  const startMs = Date.parse(startIso);
  if (Number.isNaN(startMs)) return null;

  const duration = runDurationMs(labelQty, labelsPerHour);
  if (duration === null) return null;

  return new Date(startMs + duration).toISOString();
}

/** "3h 20m" · "45m" — for the estimate hint on the machine board. */
export function formatDuration(ms: number): string {
  const mins  = Math.max(1, Math.round(ms / 60_000));
  const hours = Math.floor(mins / 60);
  if (hours < 1) return `${mins}m`;
  const rem = mins % 60;
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`;
}
