// src/lib/shelfMatch.ts
// ============================================================
// Job Separation lines that could be served partly from the shelf. A PO line
// with no job yet, whose PM code has free labels on a rack, should print
// only the difference — the Job Separation callout says so and offers
// "Make job for N".
//
// "Free" follows /api/stock/match: Extra (over-runs, reprint spares) and
// Manual (found on the shelf) belong to nobody; Remaining is an open
// order's unshipped balance and is already promised.
// ============================================================

import type { JobSeparation, LabelStock } from '@/lib/types';

export type ShelfLot = Pick<LabelStock, 'pm_code' | 'qty' | 'kind' | 'location'> & { is_dispatched?: boolean };
export type ShelfSummary = { qty: number; locations: string[] };

const key = (pm: string | null | undefined) => (pm ?? '').trim().toUpperCase();

/** Free shelf quantity per PM code (upper-cased). */
export function freeShelfByPm(stock: readonly ShelfLot[]): Map<string, ShelfSummary> {
  const out = new Map<string, ShelfSummary>();
  for (const s of stock) {
    if (s.is_dispatched || (s.kind !== 'Extra' && s.kind !== 'Manual') || !key(s.pm_code) || s.qty <= 0) continue;
    const cur = out.get(key(s.pm_code)) ?? { qty: 0, locations: [] };
    cur.qty += s.qty;
    if (s.location && !cur.locations.includes(s.location)) cur.locations.push(s.location);
    out.set(key(s.pm_code), cur);
  }
  return out;
}

export type ShelfOffer = { onShelf: number; printQty: number; locations: string[] };

type RowLike = Pick<JobSeparation, 'pm_code' | 'quantity' | 'linked_job_id'> & { cancelled_at?: string | null };

/** What the shelf can cover for one line, or null when it can't help (has a job, cancelled, nothing on the shelf). */
export function shelfOffer(row: RowLike, shelf: Map<string, ShelfSummary>): ShelfOffer | null {
  if (row.linked_job_id || row.cancelled_at || !row.quantity || row.quantity <= 0) return null;
  const s = shelf.get(key(row.pm_code));
  if (!s || s.qty <= 0) return null;
  return { onShelf: s.qty, printQty: Math.max(0, row.quantity - s.qty), locations: s.locations };
}
