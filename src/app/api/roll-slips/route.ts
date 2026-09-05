// src/app/api/roll-slips/route.ts
// ============================================================
// GET  /api/roll-slips  — recent roll-slip batches (any authenticated user)
// POST /api/roll-slips  — record a batch about to be printed (Dispatch/Admin)
// ============================================================
// Mirrors /api/box-slips. The slip renders and prints in the browser; this
// route puts the batch on record so a reprint months later reproduces what
// was physically stuck on the roll.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptPrintRollSlips } from '@/lib/constants/departments';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Guard against a slipped keystroke turning into a whole roll of wasted
// stock, not a business rule — raise it if a real consignment needs more.
const MAX_ROLL_COUNT = 500;

/** Trims to null so an empty box prints an empty cell, not "undefined". */
function optionalText(v: unknown, max = 60): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

// ── GET ───────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('job_id');

  let query = supabase
    .from('roll_slips')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

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

  if (!canDeptPrintRollSlips(perms)) {
    return NextResponse.json(
      { error: 'Only Dispatch or Admin can print roll slips' },
      { status: 403 }
    );
  }

  const body = await request.json();

  const qtyPerRoll = Number(body.qty_per_roll);
  if (!Number.isInteger(qtyPerRoll) || qtyPerRoll <= 0) {
    return NextResponse.json(
      { error: 'Quantity per roll must be a whole number above zero' },
      { status: 400 }
    );
  }

  const rollCount = Number(body.roll_count);
  if (!Number.isInteger(rollCount) || rollCount <= 0) {
    return NextResponse.json(
      { error: 'Number of rolls must be a whole number above zero' },
      { status: 400 }
    );
  }
  if (rollCount > MAX_ROLL_COUNT) {
    return NextResponse.json(
      { error: `That would print ${rollCount} slips. The limit is ${MAX_ROLL_COUNT} in one batch.` },
      { status: 400 }
    );
  }

  const slipDate = typeof body.slip_date === 'string' ? body.slip_date.trim() : '';
  if (!ISO_DATE.test(slipDate)) {
    return NextResponse.json({ error: 'Date is required' }, { status: 400 });
  }

  const admin = createAdminClient();

  // The job is the source of truth for party/PM code/PO — read from the
  // database rather than trusted from the client, so a stale or tampered
  // browser cannot put another party's name (or QR link) on a printed roll.
  const { data: job, error: jobErr } = await admin
    .from('jobs')
    .select('id, job_card_number, po_number, pm_code, party, job_name')
    .eq('id', body.job_id)
    .single();

  if (jobErr || !job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  const product =
    (typeof body.product === 'string' ? body.product.trim() : '') ||
    (job.job_name ?? '').trim();

  if (!product) {
    return NextResponse.json(
      { error: 'Product is required — the job has no name to fall back on' },
      { status: 400 }
    );
  }

  const { data, error } = await admin
    .from('roll_slips')
    .insert({
      job_id:          job.id,
      party:           job.party,
      product,
      pm_code:         job.pm_code,
      po_number:       job.po_number,
      job_card_number: job.job_card_number,
      qty_per_roll:    qtyPerRoll,
      roll_count:      rollCount,
      direction:       optionalText(body.direction, 20),
      operator:        optionalText(body.operator, 40),
      slip_date:       slipDate,
      printed_by:      perms.key,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ slip: data }, { status: 201 });
}
