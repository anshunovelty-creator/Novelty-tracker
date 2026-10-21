// src/lib/dispatchChecks.ts
// Server side of the dispatch entry checks: fetch the order lines and the
// live entries for one PO, then let lib/dispatchLedger.ts say what's wrong.
// Used by POST /api/dispatch-notifications and PATCH …/[id]. Warnings never
// block: the route answers 409 with them and saves when sent back with
// confirm: true.

import type { SupabaseClient } from '@supabase/supabase-js';
import { containsPattern } from './search';
import { pmKey } from './reports';
import { entryWarnings, lineFor, poKey } from './dispatchLedger';

export async function dispatchWarnings(
  admin: SupabaseClient,
  e: { po: string; pm: string | null; qty: number | null; excludeId?: string },
): Promise<string[]> {
  // ilike %po% finds the PO however it was spaced or cased; lineFor then
  // keeps the exact ones.
  const pattern = containsPattern(e.po.trim());
  const [lines, entries] = await Promise.all([
    admin.from('job_separations').select('id, po_no, pm_code, quantity').is('cancelled_at', null).ilike('po_no', pattern),
    admin.from('pending_dispatch_notifications').select('id, po_number, pm_code, qty, created_at').is('removed_at', null).ilike('po_number', pattern),
  ]);
  if (lines.error) throw new Error(lines.error.message);
  if (entries.error) throw new Error(entries.error.message);

  const line = lineFor(e.po, e.pm, lines.data);
  const others = entries.data.filter((x) => x.id !== e.excludeId && (line
    ? lineFor(x.po_number, x.pm_code, lines.data)?.id === line.id
    : poKey(x.po_number) === poKey(e.po) && pmKey(x.pm_code) === pmKey(e.pm)));
  return entryWarnings({ line, others, qty: e.qty, now: new Date() });
}
