// src/app/api/bom-requests/route.ts
// ============================================================
// GET  /api/bom-requests — material requests, newest first, each with the
//      Job Separation row it was raised against. bom_use.
//      ?status=pending|ordered|declined|cancelled|all  — default 'pending'
//      ?count=pending  — returns { pending: n } only, for the nav badge
// POST /api/bom-requests — "Request" pressed on a costed row. bom_use.
//      { job_separation_id, message? }
//
// The request is a snapshot. Everything the owner reads — material, width,
// metres, the rate and the expense it produced, the order value it was
// weighed against — is copied here at the moment of asking, so a later
// edit to the costing or the master rate can't change what was approved.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptUseBOM } from '@/lib/constants/departments';
import { materialExpense, BOM_JOB_SUMMARY_SELECT } from '@/lib/bom';

const STATUSES = ['pending', 'ordered', 'declined', 'cancelled'] as const;

function text(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

async function requireBomAccess() {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;
  }

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!canDeptUseBOM(perms)) {
    return {
      error: NextResponse.json({ error: 'Bill of Material access required' }, { status: 403 }),
    } as const;
  }

  return { user, perms: perms!, supabase } as const;
}

export async function GET(request: NextRequest) {
  const gate = await requireBomAccess();
  if ('error' in gate) return gate.error;

  // Badge path: the header polls this on every admin page, so it must not
  // drag the whole list across the wire just to show "3".
  if (request.nextUrl.searchParams.get('count') === 'pending') {
    const { count, error } = await gate.supabase
      .from('bom_material_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ pending: count ?? 0 });
  }

  const statusParam = request.nextUrl.searchParams.get('status') ?? 'pending';

  let query = gate.supabase
    .from('bom_material_requests')
    .select(`*, ${BOM_JOB_SUMMARY_SELECT}`)
    .order('created_at', { ascending: false });

  if ((STATUSES as readonly string[]).includes(statusParam)) {
    query = query.eq('status', statusParam);
  }
  // 'all' (or anything else) falls through unfiltered.

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ requests: data ?? [] });
}

export async function POST(request: NextRequest) {
  const gate = await requireBomAccess();
  if ('error' in gate) return gate.error;

  const body = await request.json();
  const jobSeparationId = text(body.job_separation_id);
  if (!jobSeparationId) {
    return NextResponse.json({ error: 'job_separation_id is required' }, { status: 400 });
  }

  const admin = createAdminClient();

  // The request is built from the SAVED costing, never from what the form
  // happens to hold — the row on screen and the request in the owner's
  // inbox must be the same numbers.
  const { data: costing, error: costingError } = await admin
    .from('bom_costings')
    .select('material_id, material_width_mm, running_meter, material:bom_materials(name, rate_per_sqm), job:job_separations(order_value, cancelled_at)')
    .eq('job_separation_id', jobSeparationId)
    .maybeSingle();

  if (costingError) return NextResponse.json({ error: costingError.message }, { status: 500 });
  if (!costing) {
    return NextResponse.json({ error: 'Save the material, width and metres first' }, { status: 409 });
  }

  const material = Array.isArray(costing.material) ? costing.material[0] : costing.material;
  const job      = Array.isArray(costing.job)      ? costing.job[0]      : costing.job;

  if (job?.cancelled_at) {
    return NextResponse.json({ error: 'That Job Separation row is cancelled' }, { status: 409 });
  }

  const width  = costing.material_width_mm === null ? null : Number(costing.material_width_mm);
  const metres = costing.running_meter     === null ? null : Number(costing.running_meter);
  const rate   = material ? Number(material.rate_per_sqm) : null;

  if (!costing.material_id || !material) {
    return NextResponse.json({ error: 'Pick a material before requesting it' }, { status: 409 });
  }
  if (!width || !metres) {
    return NextResponse.json({ error: 'Enter the width and running metres before requesting' }, { status: 409 });
  }
  if (!rate) {
    return NextResponse.json(
      { error: `${material.name} has no rate on the master list yet — ask Admin to set it` },
      { status: 409 }
    );
  }

  const expense = materialExpense(metres, width, rate);
  if (expense === null) {
    return NextResponse.json({ error: 'This row cannot be priced yet' }, { status: 409 });
  }

  // One open request per job. Asking twice for the same material before
  // the owner has answered once is a second nag, not a second need.
  const { count: open, error: openError } = await admin
    .from('bom_material_requests')
    .select('id', { count: 'exact', head: true })
    .eq('job_separation_id', jobSeparationId)
    .eq('status', 'pending');

  if (openError) return NextResponse.json({ error: openError.message }, { status: 500 });
  if ((open ?? 0) > 0) {
    return NextResponse.json(
      { error: 'A request for this job is already waiting for Admin' },
      { status: 409 }
    );
  }

  const { data, error } = await admin
    .from('bom_material_requests')
    .insert({
      job_separation_id: jobSeparationId,
      material_id:       costing.material_id,
      material_name:     material.name,
      material_width_mm: width,
      running_meter:     metres,
      rate_per_sqm:      rate,
      expense,
      order_value:       job?.order_value === null || job?.order_value === undefined ? null : Number(job.order_value),
      message:           text(body.message),
      requested_by_department: gate.perms.key,
      requested_by:      gate.user.email ?? gate.perms.key,
    })
    .select(`*, ${BOM_JOB_SUMMARY_SELECT}`)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ request: data }, { status: 201 });
}
