// src/app/api/job-separations/route.ts
// ============================================================
// GET  /api/job-separations  — the live worksheet (any authenticated user)
// POST /api/job-separations  — add a row (Prepress or Admin)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseDepartment, canDeptManageJobSeparation } from '@/lib/constants/departments';

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

// Optional decimal: rate carries paise, so no truncation.
function decimal(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Field-scoped search: a whitelist, not a raw column name from the query
// string. Integer columns can't take .ilike() — see the identical note in
// src/app/api/dies/route.ts — so quantity matches on the exact number.
type JobSeparationSearchField = { column: string; type: 'text' | 'int' };

const JOB_SEPARATION_SEARCH_FIELDS: Record<string, JobSeparationSearchField> = {
  sr_no:         { column: 'sr_no',         type: 'text' },
  party:         { column: 'party',         type: 'text' },
  po_no:         { column: 'po_no',         type: 'text' },
  pm_code:       { column: 'pm_code',       type: 'text' },
  material_name: { column: 'material_name', type: 'text' },
  unit:          { column: 'unit',          type: 'text' },
  job_status:    { column: 'job_status',    type: 'text' },
  jc_status:     { column: 'jc_status',     type: 'text' },
  aw_send_to:    { column: 'aw_send_to',    type: 'text' },
  quantity:      { column: 'quantity',      type: 'int' },
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
    .from('job_separations')
    .select('*')
    .order('created_at', { ascending: false });

  if (search) {
    const config = field ? JOB_SEPARATION_SEARCH_FIELDS[field] : undefined;
    if (config?.type === 'int') {
      const n = Number(search);
      // Not a whole number — an integer column can't contain it, so the
      // answer is "no matches" rather than a query error.
      if (!Number.isFinite(n)) return NextResponse.json({ job_separations: [] });
      query = query.eq(config.column, Math.trunc(n));
    } else if (config) {
      // Picked a specific text field — search just that column.
      query = query.ilike(config.column, `%${search}%`);
    } else {
      // "All fields" — the shop looks this up by whatever they can read
      // off a PO: the sr. no, the party, the PO no, the PM code, or the
      // material name.
      query = query.or(
        `sr_no.ilike.%${search}%,party.ilike.%${search}%,po_no.ilike.%${search}%,` +
        `pm_code.ilike.%${search}%,material_name.ilike.%${search}%`
      );
    }
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ job_separations: data ?? [] });
}

// ── POST ──────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dept = parseDepartment(user.user_metadata?.department);
  if (!dept) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });

  if (!canDeptManageJobSeparation(dept)) {
    return NextResponse.json(
      { error: 'Only Prepress or Admin can add job separation rows' },
      { status: 403 }
    );
  }

  const body = await request.json();

  const party = text(body.party);
  if (!party) {
    return NextResponse.json({ error: 'Party is required' }, { status: 400 });
  }

  // A caller may pin an explicit Sr. No. (e.g. correcting an import); blank
  // means "let the database trigger auto-assign one".
  const srNo = text(body.sr_no);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('job_separations')
    .insert({
      sr_no:          srNo,
      party,
      po_no:          text(body.po_no),
      po_date:        text(body.po_date),
      pm_code:        text(body.pm_code),
      material_name:  text(body.material_name),
      quantity:       integer(body.quantity),
      unit:           text(body.unit),
      job_status:     text(body.job_status),
      rate:           decimal(body.rate),
      jc_status:      text(body.jc_status),
      aw_send_to:     text(body.aw_send_to),
      created_by:     user.email ?? dept,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: `Sr. No. ${srNo} is already on another row` },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ job_separation: data }, { status: 201 });
}
