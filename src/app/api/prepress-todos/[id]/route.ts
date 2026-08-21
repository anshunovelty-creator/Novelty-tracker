// src/app/api/prepress-todos/[id]/route.ts
// ============================================================
// PATCH  /api/prepress-todos/[id] — correct a task's text (fix a typo),
//        and/or toggle its "marked read" state (body: { task } and/or
//        { read }). Marked-read just flags the row (shown green) — it
//        stays in the list for the team to verify.
// DELETE /api/prepress-todos/[id] — remove a task for good, whether
//        because it was added by mistake or because it's read, verified,
//        and done with. There is no separate "done" state to preserve
//        beyond marked-read; deleting is the only way a row disappears.
// Prepress or Admin only.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptManagePrepressTodo } from '@/lib/constants/departments';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!perms) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });

  if (!canDeptManagePrepressTodo(perms)) {
    return NextResponse.json(
      { error: 'Only Prepress or Admin can edit a checklist task' },
      { status: 403 }
    );
  }

  const body = await request.json();
  const updates: { task?: string; marked_read_at?: string | null } = {};

  if (typeof body.task === 'string') {
    const task = body.task.trim();
    if (!task) return NextResponse.json({ error: 'Task text is required' }, { status: 400 });
    updates.task = task;
  }

  if (typeof body.read === 'boolean') {
    updates.marked_read_at = body.read ? new Date().toISOString() : null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('prepress_todos')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const logs: { todo_id: string; task: string; action: string; actor_department: string; actor_email: string | null }[] = [];
  const base = { todo_id: id, task: data.task, actor_department: perms.key, actor_email: user.email ?? null };
  if (updates.task !== undefined) logs.push({ ...base, action: 'edited' });
  if (updates.marked_read_at !== undefined) {
    logs.push({ ...base, action: updates.marked_read_at ? 'completed' : 'reopened' });
  }
  if (logs.length > 0) {
    const { error: logError } = await admin.from('prepress_todo_logs').insert(logs);
    if (logError) console.error('prepress_todo_logs insert (update) failed:', logError);
  }

  return NextResponse.json({ todo: data });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!perms) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });

  if (!canDeptManagePrepressTodo(perms)) {
    return NextResponse.json(
      { error: 'Only Prepress or Admin can remove a checklist task' },
      { status: 403 }
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin.from('prepress_todos').delete().eq('id', id).select('id, task');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  const { error: logError } = await admin.from('prepress_todo_logs').insert({
    todo_id: id,
    task: data[0].task,
    action: 'deleted',
    actor_department: perms.key,
    actor_email: user.email ?? null,
  });
  if (logError) console.error('prepress_todo_logs insert (deleted) failed:', logError);

  return NextResponse.json({ ok: true });
}
