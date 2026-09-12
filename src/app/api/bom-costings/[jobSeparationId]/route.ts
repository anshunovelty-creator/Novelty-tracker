// src/app/api/bom-costings/[jobSeparationId]/route.ts
// ============================================================
// PUT /api/bom-costings/[jobSeparationId] — save the floor's three inputs
//     for one Job Separation row: material, width (mm), running metres.
//     Upsert, since a job has exactly one costing. bom_use.
//
// A half-filled row is accepted (material picked, metres not yet known) —
// the floor saves what it has and comes back. Pricing happens on read,
// from the material's current rate, so nothing here stores an expense.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptUseBOM } from '@/lib/constants/departments';
import { materialExpense } from '@/lib/bom';
import type { BomCosting } from '@/lib/types';

type Params = { params: Promise<{ jobSeparationId: string }> };

function text(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

// Positive decimal or "not entered". Zero is rejected like a negative: a
// zero-width roll or zero metres is a typo, not a measurement.
function positive(value: unknown): number | null | 'bad' {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return 'bad';
  if (n <= 0) return 'bad';
  return Math.round(n * 100) / 100;
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { jobSeparationId } = await params;

  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!perms || !canDeptUseBOM(perms)) {
    return NextResponse.json({ error: 'Bill of Material access required' }, { status: 403 });
  }

  const body = await request.json();

  const width  = positive(body.material_width_mm);
  const metres = positive(body.running_meter);
  if (width === 'bad')  return NextResponse.json({ error: 'Material width must be more than 0 mm' }, { status: 400 });
  if (metres === 'bad') return NextResponse.json({ error: 'Running metres must be more than 0' }, { status: 400 });

  const materialId = text(body.material_id);

  const admin = createAdminClient();

  // The job must exist and still be live — costing a cancelled order is
  // work nobody asked for, and the list hides those rows anyway.
  const { data: job, error: jobError } = await admin
    .from('job_separations')
    .select('id, cancelled_at')
    .eq('id', jobSeparationId)
    .maybeSingle();

  if (jobError) return NextResponse.json({ error: jobError.message }, { status: 500 });
  if (!job) return NextResponse.json({ error: 'Job Separation row not found' }, { status: 404 });
  if (job.cancelled_at) {
    return NextResponse.json({ error: 'That Job Separation row is cancelled' }, { status: 409 });
  }

  // The material has to be a real master entry — the dropdown only offers
  // active ones, but a stale tab could still send a retired or deleted id.
  let material: { name: string; rate_per_sqm: number } | null = null;
  if (materialId) {
    const { data, error } = await admin
      .from('bom_materials')
      .select('name, rate_per_sqm')
      .eq('id', materialId)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Pick a material from the list' }, { status: 400 });
    material = data;
  }

  const { data: saved, error } = await admin
    .from('bom_costings')
    .upsert(
      {
        job_separation_id: jobSeparationId,
        material_id:       materialId,
        material_width_mm: width,
        running_meter:     metres,
        updated_by:        user.email ?? perms.key,
      },
      { onConflict: 'job_separation_id' }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rate = material ? Number(material.rate_per_sqm) : null;
  const costing: BomCosting = {
    job_separation_id: saved.job_separation_id,
    material_id:       saved.material_id,
    material_name:     material?.name ?? null,
    rate_per_sqm:      rate,
    material_width_mm: width,
    running_meter:     metres,
    expense:           materialExpense(metres, width, rate),
    updated_by:        saved.updated_by,
    updated_at:        saved.updated_at,
  };

  return NextResponse.json({ costing });
}
