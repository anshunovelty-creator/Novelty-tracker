// src/lib/slipSource.ts
// ============================================================
// What the slip page prints from: a job, or a Job Separation row that may
// not have become a job yet. Slips only read these few fields, so both are
// reduced to the same shape and the rest of the page never has to care
// which one was picked.
//
// Used by: src/components/admin/SlipsManager.tsx and AddCustomDispatchModal.tsx
// (type a PM code, PO or party, pick the order, its details fill in).
// ============================================================

import type { Job, JobSeparation } from '@/lib/types';

export type SlipSource = {
  id:              string;
  from:            'job' | 'separation';
  /** Job card number, or the Job Separation Sr No (e.g. AUG26-1). */
  job_card_number: string | null;
  /** The job name, or the row's material name — what the slip calls the product. */
  job_name:        string | null;
  label_qty:       number | null;
  party:           string;
  pm_code:         string | null;
  po_number:       string | null;
};

export function slipSourceFromJob(j: Job): SlipSource {
  return {
    id:              j.id,
    from:            'job',
    job_card_number: j.job_card_number,
    job_name:        j.job_name,
    label_qty:       j.label_qty,
    party:           j.party,
    pm_code:         j.pm_code,
    po_number:       j.po_number,
  };
}

export function slipSourceFromSeparation(r: JobSeparation): SlipSource {
  return {
    id:              r.id,
    from:            'separation',
    job_card_number: r.linked_job_card_number ?? r.sr_no,
    job_name:        r.material_name,
    label_qty:       r.quantity,
    party:           r.party,
    pm_code:         r.pm_code,
    po_number:       r.po_no,
  };
}

/**
 * Job Separation rows worth offering beside the job results: not cancelled,
 * and not already shown as the job they became.
 */
export function separationsToOffer(rows: JobSeparation[], jobIds: ReadonlySet<string>): JobSeparation[] {
  return rows.filter((r) => !r.cancelled_at && !(r.linked_job_id && jobIds.has(r.linked_job_id)));
}

export type SourceMatches = { jobs: SlipSource[]; separations: SlipSource[] };

/**
 * Jobs and Job Separation rows matching `term` (card / Sr no, PO, party, PM
 * code or job name), every date — the order being packed or dispatched may
 * be old. Either lookup may fail on its own; it then just contributes
 * nothing, rather than an error on every keystroke over a flaky link.
 */
export async function searchSources(term: string): Promise<SourceMatches> {
  const q = encodeURIComponent(term);
  const get = async <T,>(url: string, key: string): Promise<T[]> => {
    try {
      const res = await fetch(url);
      return res.ok ? ((await res.json())[key] ?? []) : [];
    } catch { return []; }
  };
  const [jobs, seps] = await Promise.all([
    get<Job>(`/api/jobs?search=${q}`, 'jobs'),
    get<JobSeparation>(`/api/job-separations?search=${q}&range=all&limit=8`, 'job_separations'),
  ]);
  const shown = jobs.slice(0, 8);
  return {
    jobs:        shown.map(slipSourceFromJob),
    separations: separationsToOffer(seps, new Set(shown.map((j) => j.id))).map(slipSourceFromSeparation),
  };
}
