// src/app/api/jobs/route.ts
// ============================================================
// GET  /api/jobs  — list all active jobs (sorted by delivery_date ASC)
// POST /api/jobs  — create a new job + optional dispatch schedule rows
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseDepartment } from '@/lib/constants/departments';
import { createJobRecord } from '@/lib/jobs/createJob';
import type { AddJobFormData } from '@/lib/types';

// ── GET ───────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  // Verify authenticated
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status    = searchParams.get('status');
  const urgent    = searchParams.get('urgent');
  const search    = searchParams.get('search');
  const closed    = searchParams.get('closed') === 'true';

  let query = supabase
    .from('jobs')
    .select('*, job_stage_timestamps(stage), printing_units(id, name, printing_method)')
    .eq('is_closed', closed)
    .order('delivery_date', { ascending: true, nullsFirst: false });

  if (status)  query = query.eq('status', status);
  if (urgent === 'true')  query = query.eq('urgent', true);
  if (search) {
    // job_card_number first: prepress reads a number off a printed card
    // and searches for it, so it is the most common lookup on the floor.
    query = query.or(
      `job_card_number.ilike.%${search}%,po_number.ilike.%${search}%,party.ilike.%${search}%,job_name.ilike.%${search}%`
    );
  }

  const { data, error } = await query;

  if (error) {
    console.error('[GET /api/jobs]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ jobs: data });
}

// ── POST ──────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  // Verify authenticated + get department
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dept = parseDepartment(user.user_metadata?.department);
  if (!dept) {
    return NextResponse.json({ error: 'Invalid department in token' }, { status: 403 });
  }

  const body: AddJobFormData = await request.json();

  // Use admin client to bypass RLS for insert — we've already verified auth above
  const admin = createAdminClient();

  const result = await createJobRecord(admin, dept, body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ job: result.job }, { status: 201 });
}
