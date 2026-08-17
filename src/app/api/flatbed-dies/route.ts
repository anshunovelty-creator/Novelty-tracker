// src/app/api/flatbed-dies/route.ts
// ============================================================
// GET  /api/flatbed-dies  — the flatbed die library (any authenticated user)
// POST /api/flatbed-dies  — add a flatbed die record (Prepress or Admin)
//
// Mirrors /api/dies, minus job_name/material/cylinder/status/damage
// (flatbed dies carry no job/material identity and no status tracking)
// plus `shape`. serial_no is DB-assigned (identity column) — never
// accepted from the client.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseDepartment, canDeptManageDiesPlates } from '@/lib/constants/departments';

// Optional free text: blank means "not recorded", not an empty string.
function text(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

// Optional whole number: anything unparseable is treated as not recorded.
function integer(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

// Field-scoped search: a whitelist, not a raw column name from the query
// string. Integer columns match on the exact number — see /api/dies for
// why .ilike() can't be used on them.
type FlatbedDieSearchField = { column: string; type: 'text' | 'int' };

const FLATBED_DIE_SEARCH_FIELDS: Record<string, FlatbedDieSearchField> = {
  serial_no: { column: 'serial_no', type: 'int' },
  shape:     { column: 'shape',     type: 'text' },
  corner:    { column: 'corner',    type: 'text' },
  location:  { column: 'location',  type: 'text' },
  length:    { column: 'length',    type: 'text' },
  width:     { column: 'width',     type: 'text' },
  gap:       { column: 'gap',       type: 'text' },
  ups:       { column: 'ups',       type: 'int' },
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
    .from('flatbed_dies')
    .select('*')
    .order('created_at', { ascending: false });

  if (search) {
    const config = field ? FLATBED_DIE_SEARCH_FIELDS[field] : undefined;
    if (config?.type === 'int') {
      const n = Number(search);
      if (!Number.isFinite(n)) return NextResponse.json({ flatbed_dies: [] });
      query = query.eq(config.column, Math.trunc(n));
    } else if (config) {
      query = query.ilike(config.column, `%${search}%`);
    } else {
      // "All fields" — shape, corner, location are the only free-text
      // columns worth matching a loose search against.
      query = query.or(
        `shape.ilike.%${search}%,corner.ilike.%${search}%,location.ilike.%${search}%`
      );
    }
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ flatbed_dies: data ?? [] });
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
      { error: 'Only Prepress or Admin can add flatbed dies' },
      { status: 403 }
    );
  }

  const body = await request.json();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('flatbed_dies')
    .insert({
      length:          text(body.length),
      width:           text(body.width),
      ups:             integer(body.ups),
      gap:             text(body.gap),
      corner:          text(body.corner),
      shape:           text(body.shape),
      location:        text(body.location),
      die_received_on: text(body.die_received_on),
      created_by:      user.email ?? dept,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ flatbed_die: data }, { status: 201 });
}
