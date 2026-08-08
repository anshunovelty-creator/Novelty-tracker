// src/app/api/prepress-todos/[id]/route.ts
// ============================================================
// PATCH  /api/prepress-todos/[id] — correct a task's text (fix a typo).
// DELETE /api/prepress-todos/[id] — remove a task, whether because it's
//        done or because it was added by mistake. There is no "done"
//        state to preserve; both cases just delete the row — the panel
//        distinguishes them in the UI (one-tap Done vs confirm-first
//        Delete), not in what happens here.
// Prepress or Admin only.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseDepartment, canDeptManageJobSeparation } from '@/lib/constants/departments';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dept = parseDepartment(user.user_metadata?.department);
  if (!dept) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });

  if (!canDeptManageJobSeparation(dept)) {
    return NextResponse.json(
      { error: 'Only Prepress or Admin can edit a checklist task' },
      { status: 403 }
    );
  }

  const body = await request.json();
  const task = typeof body.task === 'string' ? body.task.trim() : '';
  if (!task) return NextResponse.json({ error: 'Task text is required' }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('prepress_todos')
    .update({ task })
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ todo: data });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dept = parseDepartment(user.user_metadata?.department);
  if (!dept) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });

  if (!canDeptManageJobSeparation(dept)) {
    return NextResponse.json(
      { error: 'Only Prepress or Admin can remove a checklist task' },
      { status: 403 }
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin.from('prepress_todos').delete().eq('id', id).select('id');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  return NextResponse.json({ ok: true });
}
