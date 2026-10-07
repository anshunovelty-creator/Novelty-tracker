// src/lib/floorQueue.ts
// The press floor's phone queue: which jobs can go on a press right now, and
// which are already running. "Ready" means the stage before In Printing is
// done — Shade Card Approved for a New job, Job Card Done for a Repeat (which
// skips the sample and shade card). Scheduled-release jobs print per release
// from their own card, so they never queue here.

import { getPrerequisite } from '@/lib/constants/stages';
import type { Job } from '@/lib/types';

export function isReadyToPrint(job: Job): boolean {
  if (job.is_closed || job.is_scheduled_release) return false;
  return job.status === getPrerequisite('In Printing', job.job_type);
}

/** Urgent first by priority (P1 before P2), then the nearest delivery date. */
export function floorCompare(a: Job, b: Job): number {
  const ua = a.urgent ? (a.urgent_priority ?? 9) : 99;
  const ub = b.urgent ? (b.urgent_priority ?? 9) : 99;
  if (ua !== ub) return ua - ub;
  const da = a.delivery_date ?? '9999-12-31';
  const db = b.delivery_date ?? '9999-12-31';
  return da.localeCompare(db);
}

export function floorQueue(jobs: Job[], canPrint: (job: Job) => boolean) {
  return {
    ready:   jobs.filter((j) => isReadyToPrint(j) && canPrint(j)).sort(floorCompare),
    running: jobs.filter((j) => j.status === 'In Printing' && !j.is_closed && canPrint(j)).sort(floorCompare),
  };
}
