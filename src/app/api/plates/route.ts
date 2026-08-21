// src/app/api/plates/route.ts
// ============================================================
// GET  /api/plates  — the plate list (any authenticated user)
// POST /api/plates  — record a plate (Prepress or Admin)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptManageDiesPlates } from '@/lib/constants/departments';

function optionalText(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

function optionalInt(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

// Field-scoped search: a whitelist, not a raw column name from the query
// string, so a request can never point .ilike() at an arbitrary column.
// Integer columns can't take .ilike() — Postgres has no ILIKE for integer
// and PostgREST/supabase-js does not apply a `column::text` cast through
// the filter builder (confirmed: it raises "operator does not exist:
// integer ~~* unknown") — so those match on the exact number instead.
type PlateSearchField = { column: string; type: 'text' | 'int' };

const PLATE_SEARCH_FIELDS: Record<string, PlateSearchField> = {
  party:           { column: 'party',           type: 'text' },
  plate_id:        { column: 'plate_id',        type: 'text' },
  pm_code:         { column: 'pm_code',         type: 'text' },
  item_name:       { column: 'item_name',       type: 'text' },
  location:        { column: 'location',        type: 'text' },
  across_size:     { column: 'across_size',     type: 'text' },
  around_size:     { column: 'around_size',     type: 'text' },
  cylinder:        { column: 'cylinder',        type: 'int' },
  label_per_round: { column: 'label_per_round', type: 'int' },
};

// ── GET ───────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search')?.trim();
  const field  = searchParams.get('field')?.trim();

  let query = supabase
    .from('plates')
    .select('*')
    .order('created_at', { ascending: false });

  if (search) {
    const config = field ? PLATE_SEARCH_FIELDS[field] : undefined;
    if (config?.type === 'int') {
      const n = Number(search);
      // Not a whole number — an integer column can't contain it, so the
      // answer is "no matches" rather than a query error.
      if (!Number.isFinite(n)) return NextResponse.json({ plates: [] });
      query = query.eq(config.column, Math.trunc(n));
    } else if (config) {
      // Picked a specific text field — search just that column.
      query = query.ilike(config.column, `%${search}%`);
    } else {
      // "All fields" — someone standing at the rack searches by whatever
      // they have: the party that ordered it, the PM code, the item, or
      // the serial on the plate.
      query = query.or(
        `party.ilike.%${search}%,pm_code.ilike.%${search}%,` +
        `item_name.ilike.%${search}%,plate_id.ilike.%${search}%`
      );
    }
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

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!perms) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });

  if (!canDeptManageDiesPlates(perms)) {
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
      created_by:      user.email ?? perms.key,
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
