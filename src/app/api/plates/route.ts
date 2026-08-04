// src/app/api/plates/route.ts
// ============================================================
// GET  /api/plates  — the plate list (any authenticated user)
// POST /api/plates  — record a plate (Prepress or Admin)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseDepartment, canDeptManageDiesPlates } from '@/lib/constants/departments';

function optionalText(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

function optionalInt(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

// ── GET ───────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search')?.trim();

  let query = supabase
    .from('plates')
    .select('*')
    .order('created_at', { ascending: false });

  // Someone standing at the rack searches by whatever they have: the party
  // that ordered it, the PM code, the item, or the serial on the plate.
  if (search) {
    query = query.or(
      `party.ilike.%${search}%,pm_code.ilike.%${search}%,` +
      `item_name.ilike.%${search}%,plate_id.ilike.%${search}%`
    );
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ plates: data ?? [] });
}

// ── POST ──────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dept = parseDepartment(user.user_metadata?.department);
  if (!dept) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });

  if (!canDeptManageDiesPlates(dept)) {
    return NextResponse.json(
      { error: 'Only Prepress or Admin can add plates' },
      { status: 403 }
    );
  }

  const body = await request.json();

  const party = typeof body.party === 'string' ? body.party.trim() : '';
  if (!party) {
    return NextResponse.json({ error: 'Party is required' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('plates')
    .insert({
      party,
      pm_code:         optionalText(body.pm_code),
      item_name:       optionalText(body.item_name),
      across_size:     optionalText(body.across_size),
      around_size:     optionalText(body.around_size),
      cylinder:        optionalInt(body.cylinder),
      plate_id:        optionalText(body.plate_id),
      plate_date:      optionalText(body.plate_date),
      label_per_round: optionalInt(body.label_per_round),
      location:        optionalText(body.location),
      created_by:      user.email ?? dept,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'A plate with that plate ID already exists' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ plate: data }, { status: 201 });
}
