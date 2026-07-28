// src/app/api/printing-units/route.ts
// ============================================================
// GET  /api/printing-units  — list units (any authenticated staff)
// POST /api/printing-units  — create a unit (Admin only)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseDepartment } from '@/lib/constants/departments';
import { PRINTING_METHODS, type PrintingMethod } from '@/lib/types';

// ── GET ───────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Job-assignment dropdowns only ever offer active units; the admin
  // management screen passes ?all=true to also see retired ones.
  const includeInactive = new URL(request.url).searchParams.get('all') === 'true';

  let query = supabase
    .from('printing_units')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (!includeInactive) query = query.eq('is_active', true);

  const { data, error } = await query;

  if (error) {
    console.error('[GET /api/printing-units]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ units: data });
}

// ── POST ──────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Units define how the floor is organised — Admin only, matching the
  // delete-job restriction already enforced in JobRow/JobCard.
  const dept = parseDepartment(user.user_metadata?.department);
  if (dept !== 'Admin') {
    return NextResponse.json(
      { error: 'Only Admin can create printing units' },
      { status: 403 },
    );
  }

  const body = await request.json() as {
    name?: string;
    printing_method?: PrintingMethod;
    sort_order?: number;
  };

  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: 'Unit name is required' }, { status: 400 });
  }
  if (!body.printing_method || !PRINTING_METHODS.includes(body.printing_method)) {
    return NextResponse.json(
      { error: `Printing method must be one of: ${PRINTING_METHODS.join(', ')}` },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from('printing_units')
    .insert({
      name,
      printing_method: body.printing_method,
      sort_order: body.sort_order ?? 0,
    })
    .select()
    .single();

  if (error) {
    console.error('[POST /api/printing-units]', error);
    // 23505 = unique_violation on printing_units.name — surface it as a
    // 409 so the UI can say "that name is taken" instead of a generic 500.
    if (error.code === '23505') {
      return NextResponse.json(
        { error: `A unit named "${name}" already exists` },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ unit: data }, { status: 201 });
}
