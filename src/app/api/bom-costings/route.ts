// src/app/api/bom-costings/route.ts
// ============================================================
// GET /api/bom-costings — Job Separation's rows through the costing lens:
//     each row with its costing (material, width, running metres) priced
//     against the material's current rate, and the latest request raised
//     on it. bom_use.
//
//     ?range=month|3months|all  ?search=  ?limit=   — exactly the scoping
//     /api/job-separations uses, so the two pages show the same rows.
//
// One PostgREST query: job_separations with bom_costings and
// bom_material_requests embedded through their FKs. Not two queries joined
// here — 500 job ids in an `in()` clause is a 20KB URL, and the proxy in
// front of PostgREST will not carry it.
//
// Cancelled Job Separation rows are left out. An order that isn't being
// produced has no material to price, and its request (if any) is history
// the inbox already keeps.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { getDeptPermissions, canDeptUseBOM } from '@/lib/constants/departments';
import { parseDateRange, rangeOrClause, parseLimit, searchOrClause } from '@/lib/jobSeparationQuery';
import { materialExpense } from '@/lib/bom';
import type { BomCostingRow, BomCosting, BomMaterialRequest } from '@/lib/types';

// What comes back from the embedded select below. bom_costings is 1:1 with
// job_separations (its PK is the FK), which PostgREST returns as a single
// object — but a to-many shape is tolerated too, in case the relationship
// is ever read the other way.
type RawCosting = {
  job_separation_id: string;
  material_id:       string | null;
  material_width_mm: number | null;
  running_meter:     number | null;
  updated_by:        string | null;
  updated_at:        string;
  material:          { name: string; rate_per_sqm: number } | { name: string; rate_per_sqm: number }[] | null;
};

type RawRow = {
  id:            string;
  sr_no:         string | null;
  party:         string;
  po_no:         string | null;
  po_date:       string | null;
  pm_code:       string | null;
  material_name: string | null;
  quantity:      number | null;
  order_value:   number | null;
  created_at:    string;
  costing:       RawCosting | RawCosting[] | null;
  requests:      BomMaterialRequest[] | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value === null || value === undefined) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function shapeCosting(raw: RawCosting | null): BomCosting | null {
  if (!raw) return null;
  const material = one(raw.material);
  const rate = material ? Number(material.rate_per_sqm) : null;
  const width = raw.material_width_mm === null ? null : Number(raw.material_width_mm);
  const metres = raw.running_meter === null ? null : Number(raw.running_meter);
  return {
    job_separation_id: raw.job_separation_id,
    material_id:       raw.material_id,
    material_name:     material?.name ?? null,
    rate_per_sqm:      rate,
    material_width_mm: width,
    running_meter:     metres,
    expense:           materialExpense(metres, width, rate),
    updated_by:        raw.updated_by,
    updated_at:        raw.updated_at,
  };
}

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!canDeptUseBOM(perms)) {
    return NextResponse.json({ error: 'Bill of Material access required' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search')?.trim();
  const range  = parseDateRange(searchParams.get('range'));
  const limit  = parseLimit(searchParams.get('limit'));

  let query = supabase
    .from('job_separations')
    .select(
      'id, sr_no, party, po_no, po_date, pm_code, material_name, quantity, order_value, created_at, ' +
      'costing:bom_costings(job_separation_id, material_id, material_width_mm, running_meter, updated_by, updated_at, ' +
        'material:bom_materials(name, rate_per_sqm)), ' +
      'requests:bom_material_requests(*)'
    )
    .is('cancelled_at', null)
    .order('created_at', { ascending: false })
    // Only the newest request per job travels — it's the one the row's
    // status chip reports. The inbox has the full history.
    .order('created_at', { referencedTable: 'bom_material_requests', ascending: false })
    .limit(1, { referencedTable: 'bom_material_requests' })
    .limit(limit + 1);

  const rangeClause = rangeOrClause(range);
  if (rangeClause) query = query.or(rangeClause);
  if (search) query = query.or(searchOrClause(search));

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const raw = (data ?? []) as unknown as RawRow[];
  const hasMore = raw.length > limit;
  const page = hasMore ? raw.slice(0, limit) : raw;

  const rows: BomCostingRow[] = page.map((r) => ({
    job: {
      id:            r.id,
      sr_no:         r.sr_no,
      party:         r.party,
      po_no:         r.po_no,
      po_date:       r.po_date,
      pm_code:       r.pm_code,
      material_name: r.material_name,
      quantity:      r.quantity,
      order_value:   r.order_value === null ? null : Number(r.order_value),
      created_at:    r.created_at,
    },
    costing:        shapeCosting(one(r.costing)),
    latest_request: one(r.requests),
  }));

  return NextResponse.json({ rows, hasMore });
}
