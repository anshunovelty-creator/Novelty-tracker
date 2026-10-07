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
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, invalidateDeptCache } from '@/lib/constants/departments';
import { deptKeyOf } from '@/lib/identity';

type Params = { params: Promise<{ id: string }> };

async function requireSuperAdmin() {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;

  const perms = await getDeptPermissions(deptKeyOf(user));
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

  // One transaction (save_department, migration 073): the row update and
  // each permission set's full replace land together or not at all. These
  // used to be separate delete-then-insert requests, unchecked — a failure
  // between them left the department with no permissions.
  // Only a dimension the client actually sent is replaced (null = leave it),
  // so a save from a UI that only shows the feature grid doesn't wipe out
  // stage grants nobody looked at this time.
  const strings = (v: unknown): string[] | null =>
    Array.isArray(v) ? v.filter((x: unknown): x is string => typeof x === 'string') : null;

  const { error: saveError } = await admin.rpc('save_department', {
    p_department_id: id,
    p_update:        update,
    p_features:      strings(body.features),
    p_stages:        strings(body.stages),
    p_run_stages:    strings(body.run_stages),
  });
  if (saveError) {
    const notFound = saveError.message.includes('DEPARTMENT_NOT_FOUND');
    return NextResponse.json(
      { error: notFound ? 'Department not found' : `Nothing was saved: ${saveError.message}` },
      { status: notFound ? 404 : 500 },
    );
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
