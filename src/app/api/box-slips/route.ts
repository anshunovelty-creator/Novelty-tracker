// src/app/api/box-slips/route.ts
// ============================================================
// GET  /api/box-slips  — recent box-slip batches (any authenticated user)
// POST /api/box-slips  — record a batch about to be printed (Dispatch/Admin)
// ============================================================
// The slip is rendered and printed in the browser; this route exists so the
// batch is on record — what was printed, for which job, with what box maths.
// That record is what makes a faithful reprint possible weeks later, and it
// is the reason Dispatch stops retyping the job's own details.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptPrintBoxSlips } from '@/lib/constants/departments';

/** Guards against a typo'd or timezone-mangled date reaching a printed box. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// A batch is one print run of identical slips. The ceiling is a guard against
// a slipped keystroke turning into a thousand labels of wasted stock, not a
// business rule — raise it if a genuine consignment ever needs more.
const MAX_BOX_COUNT = 200;

// ── GET ───────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('job_id');

  let query = supabase
    .from('box_slips')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  // Scoped to a job when reprinting from that job; otherwise the recent
  // history, which is what the page opens on.
  if (jobId) query = query.eq('job_id', jobId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ slips: data ?? [] });
}

// ── POST ──────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!perms) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });

  if (!canDeptPrintBoxSlips(perms)) {
    return NextResponse.json(
      { error: 'Only Dispatch or Admin can print box slips' },
      { status: 403 }
    );
  }

  const body = await request.json();

  const qtyPerBox = Number(body.qty_per_box);
  if (!Number.isInteger(qtyPerBox) || qtyPerBox <= 0) {
    return NextResponse.json(
      { error: 'Quantity per box must be a whole number above zero' },
      { status: 400 }
    );
  }

  const boxCount = Number(body.box_count);
  if (!Number.isInteger(boxCount) || boxCount <= 0) {
    return NextResponse.json(
      { error: 'Number of boxes must be a whole number above zero' },
      { status: 400 }
    );
  }
  if (boxCount > MAX_BOX_COUNT) {
    return NextResponse.json(
      { error: `That would print ${boxCount} slips. The limit is ${MAX_BOX_COUNT} in one batch.` },
      { status: 400 }
    );
  }

  const mfgDate = typeof body.mfg_date === 'string' ? body.mfg_date.trim() : '';
  if (!ISO_DATE.test(mfgDate)) {
    return NextResponse.json({ error: 'Manufacturing date is required' }, { status: 400 });
  }

  const admin = createAdminClient();

  // The job is the source of truth for party/PM code/PO — snapshotted here
  // from the database rather than accepted from the client, so a stale or
  // tampered browser cannot put a different party's name on a printed box.
  const { data: job, error: jobErr } = await admin
    .from('jobs')
    .select('id, job_card_number, po_number, pm_code, party, job_name')
    .eq('id', body.job_id)
    .single();

  if (jobErr || !job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  // Material name is the one snapshot field Dispatch may override: the slip
  // wording ("STICKER LABEL PET BOTTLE 1 LTR TRACKER") is often more specific
  // than the job name. Falling back to the job name keeps it one less field
  // to fill on the common path.
  const materialName =
    (typeof body.material_name === 'string' ? body.material_name.trim() : '') ||
    (job.job_name ?? '').trim();

  if (!materialName) {
    return NextResponse.json(
      { error: 'Material name is required — the job has no name to fall back on' },
      { status: 400 }
    );
  }

  const { data, error } = await admin
    .from('box_slips')
    .insert({
      job_id:          job.id,
      party:           job.party,
      material_name:   materialName,
      pm_code:         job.pm_code,
      po_number:       job.po_number,
      job_card_number: job.job_card_number,
      qty_per_box:     qtyPerBox,
      box_count:       boxCount,
      mfg_date:        mfgDate,
      printed_by:      perms.key,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ slip: data }, { status: 201 });
}
