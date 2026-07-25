// src/lib/api/machineDisplay.ts
// One machine's live state, shaped for the room wall display (/display/[id]).
// Shared by the server component (first paint) and the polling API route so
// both always agree on the payload.

import { cache } from 'react';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Machine, MachineDisplayData, MachineDisplayItem } from '@/lib/types';

/** Today's calendar date in IST — the plant's local day. 'YYYY-MM-DD' */
function istToday(): string {
  // en-CA gives ISO ordering: YYYY-MM-DD
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

const JOB_FIELDS  = 'po_number, job_name, party, label_qty, delivery_date, urgent';
const ITEM_FIELDS = `id, position, status, est_start_at, est_end_at, started_at, jobs(${JOB_FIELDS})`;

/**
 * The machine, what it is printing, what is queued behind it, and the shift
 * tally. Null when the machine does not exist or has been retired — callers
 * should 404.
 *
 * cache() dedupes within a single server render: the display page asks once for
 * generateMetadata (the machine name in the tab title) and once for the page
 * itself, and without this that would be six queries per load instead of three.
 */
export const getMachineDisplayData = cache(async (
  id: string
): Promise<MachineDisplayData | null> => {
  const admin = createAdminClient();

  const day  = istToday();
  const next = new Date(`${day}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const dayAfter = next.toISOString().slice(0, 10);

  const [machineRes, itemsRes, doneRes] = await Promise.all([
    admin.from('machines').select('*').eq('id', id).maybeSingle(),

    // Everything still open on this machine, in queue order
    admin.from('machine_queue_items')
      .select(ITEM_FIELDS)
      .eq('machine_id', id)
      .neq('status', 'done')
      .order('position'),

    // Finished on this machine since midnight IST
    admin.from('machine_queue_items')
      .select('id, jobs(label_qty)')
      .eq('machine_id', id)
      .eq('status', 'done')
      .gte('completed_at', `${day}T00:00:00+05:30`)
      .lt('completed_at', `${dayAfter}T00:00:00+05:30`),
  ]);

  const machine = machineRes.data as Machine | null;
  if (!machine || machine.is_retired) return null;

  const items = (itemsRes.data ?? []) as unknown as MachineDisplayItem[];
  const done  = (doneRes.data  ?? []) as unknown as
    { id: string; jobs: { label_qty: number | null } | null }[];

  return {
    machine,
    printing: items.find((i) => i.status === 'printing') ?? null,
    queued:   items.filter((i) => i.status === 'queued'),
    completed_today: {
      count:  done.length,
      labels: done.reduce((sum, d) => sum + (d.jobs?.label_qty ?? 0), 0),
    },
    server_time: new Date().toISOString(),
  };
});

/** Every machine on the board — powers the /display index picker. */
export async function listDisplayMachines(): Promise<Machine[]> {
  const admin = createAdminClient();
  const { data } = await admin.from('machines')
    .select('*')
    .eq('is_retired', false)
    .order('created_at');
  return (data ?? []) as Machine[];
}
