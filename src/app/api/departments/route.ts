// src/app/api/departments/route.ts
// ============================================================
// GET  /api/departments — the list of configured departments, each with
//      its granted feature_keys/stages/run_stages (any authenticated
//      user; matches the open SELECT RLS policy on `departments` and the
//      three permission tables, migration 039). Used by AddMemberModal's
//      "assign department" dropdown, TeamManager/HistoryPanel's
//      display-name lookup, and the /admin/departments management page.
// POST /api/departments — create a department (super-admin only).
//      key is permanent once created — it's what gets written into a
//      user's JWT metadata, so renaming it later would silently strand
//      any account already assigned to it.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, invalidateDeptCache } from '@/lib/constants/departments';

const KEY_RE = /^[A-Za-z][A-Za-z0-9_-]{1,49}$/;

export async function GET() {
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [depts, features, stages, runStages] = await Promise.all([
    supabase.from('departments').select('*').order('display_name'),
    supabase.from('department_feature_permissions').select('department_id, feature_key'),
    supabase.from('department_stage_permissions').select('department_id, stage'),
    supabase.from('department_run_stage_permissions').select('department_id, run_stage'),
  ]);

  if (depts.error) return NextResponse.json({ error: depts.error.message }, { status: 500 });

  const result = (depts.data ?? []).map((d) => ({
    ...d,
    features:   (features.data ?? []).filter((f) => f.department_id === d.id).map((f) => f.feature_key),
    stages:     (stages.data ?? []).filter((s) => s.department_id === d.id).map((s) => s.stage),
    run_stages: (runStages.data ?? []).filter((r) => r.department_id === d.id).map((r) => r.run_stage),
  }));

  return NextResponse.json({ departments: result });
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!perms?.isSuperAdmin) {
    return NextResponse.json({ error: 'Only the super-admin department can create departments' }, { status: 403 });
  }

  const body = await request.json();
  const key = typeof body.key === 'string' ? body.key.trim() : '';
  const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : '';
  const clientFacingName = typeof body.client_facing_name === 'string' ? body.client_facing_name.trim() || null : null;
  const printingMethodScope = body.printing_method_scope === 'Offset' || body.printing_method_scope === 'Flexo'
    ? body.printing_method_scope
    : null;
  const allStages = body.all_stages === true;
  const features = Array.isArray(body.features) ? body.features.filter((f: unknown) => typeof f === 'string') : [];
  const stages = Array.isArray(body.stages) ? body.stages.filter((s: unknown) => typeof s === 'string') : [];
  const runStages = Array.isArray(body.run_stages) ? body.run_stages.filter((r: unknown) => typeof r === 'string') : [];

  if (!KEY_RE.test(key)) {
    return NextResponse.json(
      { error: 'Key must start with a letter and be 2-50 characters (letters, numbers, _ or -)' },
      { status: 400 }
    );
  }
  if (!displayName) return NextResponse.json({ error: 'Display name is required' }, { status: 400 });

  const admin = createAdminClient();

  const { data: dept, error } = await admin
    .from('departments')
    .insert({
      key,
      display_name: displayName,
      client_facing_name: clientFacingName,
      printing_method_scope: printingMethodScope,
      all_stages: allStages,
      // is_protected / is_super_admin / is_read_only are never settable
      // through this API — they default to false and stay that way for
      // every department created here. There is exactly one protected
      // super-admin department, seeded once, by design.
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: `A department with key "${key}" already exists` }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (features.length) {
    await admin.from('department_feature_permissions').insert(
      features.map((feature_key: string) => ({ department_id: dept.id, feature_key }))
    );
  }
  if (stages.length) {
    await admin.from('department_stage_permissions').insert(
      stages.map((stage: string) => ({ department_id: dept.id, stage }))
    );
  }
  if (runStages.length) {
    await admin.from('department_run_stage_permissions').insert(
      runStages.map((run_stage: string) => ({ department_id: dept.id, run_stage }))
    );
  }

  invalidateDeptCache();

  return NextResponse.json({ department: dept }, { status: 201 });
}
