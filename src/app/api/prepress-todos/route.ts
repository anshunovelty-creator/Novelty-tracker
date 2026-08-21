// src/app/api/prepress-todos/route.ts
// ============================================================
// GET  /api/prepress-todos — the shared Prepress checklist (Prepress or Admin)
// POST /api/prepress-todos — add a task (Prepress or Admin)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptManagePrepressTodo } from '@/lib/constants/departments';

export async function GET(_request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!perms) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });

  // Same team that owns Job Separation owns this checklist — no other
  // consumer needs it, unlike parties' open read for the typeahead.
  if (!canDeptManagePrepressTodo(perms)) {
    return NextResponse.json(
      { error: 'Only Prepress or Admin can view this checklist' },
      { status: 403 }
    );
  }

  const { data, error } = await supabase
    .from('prepress_todos')
    .select('*')
    .order('created_at');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ todos: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!perms) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });

  if (!canDeptManagePrepressTodo(perms)) {
    return NextResponse.json(
      { error: 'Only Prepress or Admin can add to this checklist' },
      { status: 403 }
    );
  }

  const body = await request.json();
  const task = typeof body.task === 'string' ? body.task.trim() : '';
  if (!task) return NextResponse.json({ error: 'Task text is required' }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('prepress_todos')
    .insert({ task, created_by: user.email ?? perms.key })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { error: logError } = await admin.from('prepress_todo_logs').insert({
    todo_id: data.id,
    task: data.task,
    action: 'created',
    actor_department: perms.key,
    actor_email: user.email ?? null,
  });
  if (logError) console.error('prepress_todo_logs insert (created) failed:', logError);

  return NextResponse.json({ todo: data }, { status: 201 });
}
