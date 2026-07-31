// src/lib/api/labelStock.ts
// Server-side stock writes triggered by the dispatch flow.
//
// These run as side-effects of a status change, so they are deliberately
// non-throwing: a stock bookkeeping failure must never roll back or block
// the dispatch itself. The dispatch is the physical truth; the shelf record
// catching up is secondary. Failures are returned to the caller to log.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Job } from '@/lib/types';

/** Job identity copied onto every stock row so it survives the job. */
function snapshot(job: Job) {
  return {
    job_id:          job.id,
    job_card_number: job.job_card_number,
    po_number:       job.po_number,
    pm_code:         job.pm_code,
    party:           job.party,
    job_name:        job.job_name,
  };
}

/**
 * A partial dispatch leaves the balance of the printed run on the shelf.
 * One live 'Remaining' row per job (enforced by a partial unique index), so
 * a second partial dispatch updates the balance rather than stacking rows.
 *
 * qty <= 0 clears the row instead: nothing is left, so nothing is in stock.
 */
export async function upsertRemainingStock(
  admin: SupabaseClient,
  job: Job,
  qty: number,
  actor: string | null,
): Promise<{ error: string | null }> {
  if (qty <= 0) return clearRemainingStock(admin, job.id, actor);

  const { data: existing, error: readErr } = await admin
    .from('label_stock')
    .select('id')
    .eq('job_id', job.id)
    .eq('kind', 'Remaining')
    .eq('is_dispatched', false)
    .maybeSingle();

  if (readErr) return { error: readErr.message };

  if (existing) {
    const { error } = await admin
      .from('label_stock')
      .update({ qty, ...snapshot(job) })
      .eq('id', existing.id);
    return { error: error?.message ?? null };
  }

  const { error } = await admin
    .from('label_stock')
    .insert({ ...snapshot(job), kind: 'Remaining', qty, created_by: actor });
  return { error: error?.message ?? null };
}

/**
 * Full dispatch — the balance left the building, so the 'Remaining' row goes.
 * Marked dispatched rather than deleted: the shelf history stays answerable.
 * 'Extra' rows are untouched by design; surplus does not ship with the order.
 */
export async function clearRemainingStock(
  admin: SupabaseClient,
  jobId: string,
  actor: string | null = null,
): Promise<{ error: string | null }> {
  const { error } = await admin
    .from('label_stock')
    .update({
      is_dispatched: true,
      dispatched_at: new Date().toISOString(),
      dispatched_by: actor,
    })
    .eq('job_id', jobId)
    .eq('kind', 'Remaining')
    .eq('is_dispatched', false);
  return { error: error?.message ?? null };
}

/**
 * Surplus printed beyond the order, reported by Dispatch at full dispatch.
 * Always a new row — two separate over-runs are two separate piles.
 */
export async function addExtraStock(
  admin: SupabaseClient,
  job: Job,
  qty: number,
  actor: string | null,
  location?: string | null,
  remark?: string | null,
): Promise<{ error: string | null }> {
  if (qty <= 0) return { error: null };

  const { error } = await admin
    .from('label_stock')
    .insert({
      ...snapshot(job),
      kind:       'Extra',
      qty,
      location:   location?.trim() || null,
      remark:     remark?.trim()   || null,
      created_by: actor,
    });
  return { error: error?.message ?? null };
}
