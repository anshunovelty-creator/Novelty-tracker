// src/lib/slipSource.ts
// ============================================================
// What the slip page prints from: a job, or a Job Separation row that may
// not have become a job yet. Slips only read these few fields, so both are
// reduced to the same shape and the rest of the page never has to care
// which one was picked.
//
// Used by: src/components/admin/SlipsManager.tsx.
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
