// src/app/api/dies/route.ts
// ============================================================
// GET  /api/dies  — the die library (any authenticated user)
// POST /api/dies  — add a die record (Prepress or Admin)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseDepartment, canDeptManageDiesPlates } from '@/lib/constants/departments';
import { DIE_STATUSES, type DieStatus } from '@/lib/types';

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

// Status and its damage fields travel together: 'DAMAGE' requires both a
// date and a reason, anything else clears them — a die back in use or held
// as a spare doesn't carry a stale damage record.
function resolveStatus(body: Record<string, unknown>):
  | { ok: true; status: DieStatus; damage_date: string | null; damage_reason: string | null }
  | { ok: false; error: string } {
  const raw = typeof body.status === 'string' ? body.status.trim() : 'IN USE';
  const status = (DIE_STATUSES as string[]).includes(raw) ? (raw as DieStatus) : null;
  if (!status) return { ok: false, error: 'Invalid die status' };

  if (status !== 'DAMAGE') {
    return { ok: true, status, damage_date: null, damage_reason: null };
  }

  const damageDate   = text(body.damage_date);
  const damageReason = text(body.damage_reason);
  if (!damageDate || !damageReason) {
    return { ok: false, error: 'Damage date and reason are required when status is Damage' };
  }
  return { ok: true, status, damage_date: damageDate, damage_reason: damageReason };
}

// Field-scoped search: a whitelist, not a raw column name from the query
// string, so a request can never point .ilike() at an arbitrary column.
// Integer columns can't take .ilike() — Postgres has no ILIKE for integer
// and PostgREST/supabase-js does not apply a `column::text` cast through
// the filter builder (confirmed: it raises "operator does not exist:
// integer ~~* unknown") — so those match on the exact number instead.
type DieSearchField = { column: string; type: 'text' | 'int' };

const DIE_SEARCH_FIELDS: Record<string, DieSearchField> = {
  job_name:  { column: 'job_name',  type: 'text' },
  serial_no: { column: 'serial_no', type: 'text' },
  material:  { column: 'material',  type: 'text' },
  corner:    { column: 'corner',    type: 'text' },
  location:  { column: 'location',  type: 'text' },
  length:    { column: 'length',    type: 'text' },
  width:     { column: 'width',     type: 'text' },
  gap:       { column: 'gap',       type: 'text' },
  cylinder:  { column: 'cylinder',  type: 'int' },
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
    .from('dies')
    .select('*')
    .order('created_at', { ascending: false });

  if (search) {
    const config = field ? DIE_SEARCH_FIELDS[field] : undefined;
    if (config?.type === 'int') {
      const n = Number(search);
      // Not a whole number — an integer column can't contain it, so the
      // answer is "no matches" rather than a query error.
      if (!Number.isFinite(n)) return NextResponse.json({ dies: [] });
      query = query.eq(config.column, Math.trunc(n));
    } else if (config) {
      // Picked a specific text field — search just that column.
      query = query.ilike(config.column, `%${search}%`);
    } else {
      // "All fields" — someone holding a die searches by whatever they can
      // read off it: the job it was cut for, its material, its corner
      // style, or its serial — or where it should be sitting.
      query = query.or(
        `job_name.ilike.%${search}%,material.ilike.%${search}%,` +
        `corner.ilike.%${search}%,serial_no.ilike.%${search}%,location.ilike.%${search}%`
      );
    }
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ dies: data ?? [] });
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
      { error: 'Only Prepress or Admin can add dies' },
      { status: 403 }
    );
  }

  const body = await request.json();

  const jobName = text(body.job_name);
  if (!jobName) {
    return NextResponse.json({ error: 'Job name is required' }, { status: 400 });
  }

  const serialNo = text(body.serial_no);

  const statusResult = resolveStatus(body);
  if (!statusResult.ok) {
    return NextResponse.json({ error: statusResult.error }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('dies')
    .insert({
      job_name:        jobName,
      length:          text(body.length),
      width:           text(body.width),
      cylinder:        integer(body.cylinder),
      material:        text(body.material),
      ups:             integer(body.ups),
      gap:             text(body.gap),
      corner:          text(body.corner),
      serial_no:       serialNo,
      die_received_on: text(body.die_received_on),
      location:        text(body.location),
      status:          statusResult.status,
      damage_date:     statusResult.damage_date,
      damage_reason:   statusResult.damage_reason,
      created_by:      user.email ?? dept,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: `Serial no ${serialNo} is already on another die` },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ die: data }, { status: 201 });
}
