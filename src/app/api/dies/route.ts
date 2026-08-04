// src/app/api/dies/route.ts
// ============================================================
// GET  /api/dies  — the die library (any authenticated user)
// POST /api/dies  — add a die record (Prepress or Admin)
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

// ── GET ───────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search')?.trim();

  let query = supabase
    .from('dies')
    .select('*')
    .order('created_at', { ascending: false });

  // Someone holding a die searches by whatever they can read off it — the
  // job it was cut for, its material, its corner style, or its serial.
  if (search) {
    query = query.or(
      `job_name.ilike.%${search}%,material.ilike.%${search}%,` +
      `corner.ilike.%${search}%,serial_no.ilike.%${search}%`
    );
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
