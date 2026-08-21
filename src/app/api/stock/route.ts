// src/app/api/stock/route.ts
// ============================================================
// GET  /api/stock  — live label stock (any authenticated user)
// POST /api/stock  — manual stock entry (Dispatch or Admin)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptManageStock } from '@/lib/constants/departments';

// ── GET ───────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search')?.trim();
  // History view — stock already shipped out. Off by default: the page is a
  // picture of what is on the shelf right now.
  const includeDispatched = searchParams.get('include_dispatched') === 'true';

  let query = supabase
    .from('label_stock')
    .select('*')
    .order('created_at', { ascending: false });

  if (!includeDispatched) query = query.eq('is_dispatched', false);

  // Someone at the shelf has a label in hand: they search by whatever is
  // printed on it — card number, PO, PM code, party or job name.
  if (search) {
    query = query.or(
      `job_card_number.ilike.%${search}%,po_number.ilike.%${search}%,` +
      `pm_code.ilike.%${search}%,party.ilike.%${search}%,job_name.ilike.%${search}%,` +
      `location.ilike.%${search}%`
    );
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ stock: data ?? [] });
}

// ── POST ──────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!perms) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });

  if (!canDeptManageStock(perms)) {
    return NextResponse.json(
      { error: 'Only Dispatch or Admin can add stock' },
      { status: 403 }
    );
  }

  const body = await request.json();

  const qty = Number(body.qty);
  if (!Number.isFinite(qty) || qty <= 0) {
    return NextResponse.json({ error: 'Quantity must be a positive number' }, { status: 400 });
  }

  const admin = createAdminClient();

  // A manual entry may name a job or stand alone (stock found with no
  // traceable job). When a job is named, its identity is snapshotted from
  // the database rather than trusted from the client.
  let jobSnapshot: Record<string, unknown> = {
    job_id:          null,
    job_card_number: null,
    po_number:       null,
    pm_code:         typeof body.pm_code === 'string' ? body.pm_code.trim() || null : null,
    party:           typeof body.party   === 'string' ? body.party.trim()   : '',
    job_name:        typeof body.job_name === 'string' ? body.job_name.trim() || null : null,
  };

  if (body.job_id) {
    const { data: job, error: jobErr } = await admin
      .from('jobs')
      .select('id, job_card_number, po_number, pm_code, party, job_name')
      .eq('id', body.job_id)
      .single();

    if (jobErr || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }
    jobSnapshot = {
      job_id:          job.id,
      job_card_number: job.job_card_number,
      po_number:       job.po_number,
      pm_code:         job.pm_code,
      party:           job.party,
      job_name:        job.job_name,
    };
  }

  if (!String(jobSnapshot.party ?? '').trim()) {
    return NextResponse.json(
      { error: 'Party is required — pick a job or type the party name' },
      { status: 400 }
    );
  }

  const { data, error } = await admin
    .from('label_stock')
    .insert({
      ...jobSnapshot,
      kind:       'Manual',
      qty,
      location:   typeof body.location === 'string' ? body.location.trim() || null : null,
      remark:     typeof body.remark   === 'string' ? body.remark.trim()   || null : null,
      created_by: user.email ?? perms.key,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ stock: data }, { status: 201 });
}
