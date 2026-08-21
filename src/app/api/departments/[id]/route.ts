// src/app/api/departments/[id]/route.ts
// ============================================================
// PATCH /api/departments/[id] — update a department's display name,
//       printing-method scope, all_stages toggle, and its full set of
//       granted features/stages/run_stages (full-replace, not a diff —
//       the client sends the complete desired arrays each save).
//       Super-admin only. `key` is never accepted here — see the note
//       in the collection route on why it's permanent. is_protected /
//       is_super_admin / is_read_only are structural and never
//       settable through this API either way.
// DELETE /api/departments/[id] — remove a department. Blocked for
//       protected departments (Admin, Viewer). Cascades to its
//       permission rows via the FK ON DELETE CASCADE from migration 039.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, invalidateDeptCache } from '@/lib/constants/departments';

type Params = { params: Promise<{ id: string }> };

async function requireSuperAdmin() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!perms?.isSuperAdmin) {
    return { error: NextResponse.json({ error: 'Only the super-admin department can manage departments' }, { status: 403 }) } as const;
  }
  return { perms } as const;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const gate = await requireSuperAdmin();
  if ('error' in gate) return gate.error;

  const { id } = await params;
  const body = await request.json();
  const admin = createAdminClient();

  const update: Record<string, unknown> = {};
  if (typeof body.display_name === 'string' && body.display_name.trim()) {
    update.display_name = body.display_name.trim();
  }
  if ('client_facing_name' in body) {
    update.client_facing_name = typeof body.client_facing_name === 'string'
      ? body.client_facing_name.trim() || null
      : null;
  }
  if ('printing_method_scope' in body) {
    update.printing_method_scope = body.printing_method_scope === 'Offset' || body.printing_method_scope === 'Flexo'
      ? body.printing_method_scope
      : null;
  }
  if (typeof body.all_stages === 'boolean') {
    update.all_stages = body.all_stages;
  }

  if (Object.keys(update).length > 0) {
    const { error } = await admin.from('departments').update(update).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Full-replace pattern for each permission dimension: only touch a
  // dimension if the client actually sent it, so a save from a UI that
  // only shows the feature grid doesn't wipe out stage grants nobody
  // looked at this time.
  if (Array.isArray(body.features)) {
    const features = body.features.filter((f: unknown): f is string => typeof f === 'string');
    await admin.from('department_feature_permissions').delete().eq('department_id', id);
    if (features.length) {
      await admin.from('department_feature_permissions').insert(
        features.map((feature_key: string) => ({ department_id: id, feature_key }))
      );
    }
  }
  if (Array.isArray(body.stages)) {
    const stages = body.stages.filter((s: unknown): s is string => typeof s === 'string');
    await admin.from('department_stage_permissions').delete().eq('department_id', id);
    if (stages.length) {
      await admin.from('department_stage_permissions').insert(
        stages.map((stage: string) => ({ department_id: id, stage }))
      );
    }
  }
  if (Array.isArray(body.run_stages)) {
    const runStages = body.run_stages.filter((r: unknown): r is string => typeof r === 'string');
    await admin.from('department_run_stage_permissions').delete().eq('department_id', id);
    if (runStages.length) {
      await admin.from('department_run_stage_permissions').insert(
        runStages.map((run_stage: string) => ({ department_id: id, run_stage }))
      );
    }
  }

  invalidateDeptCache();

  const { data, error } = await admin.from('departments').select('*').eq('id', id).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ department: data });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const gate = await requireSuperAdmin();
  if ('error' in gate) return gate.error;

  const { id } = await params;
  const admin = createAdminClient();

  const { data: dept, error: lookupError } = await admin
    .from('departments')
    .select('is_protected, display_name')
    .eq('id', id)
    .single();

  if (lookupError || !dept) return NextResponse.json({ error: 'Department not found' }, { status: 404 });
  if (dept.is_protected) {
    return NextResponse.json({ error: `"${dept.display_name}" is a protected department and can't be deleted` }, { status: 400 });
  }

  const { error } = await admin.from('departments').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  invalidateDeptCache();

  return NextResponse.json({ ok: true });
}
