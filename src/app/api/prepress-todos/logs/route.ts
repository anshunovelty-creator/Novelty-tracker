// src/app/api/prepress-todos/logs/route.ts
// ============================================================
// GET /api/prepress-todos/logs            — audit trail for the checklist
// GET /api/prepress-todos/logs?q=foo      — search it (task text, actor
//      email, actor department)
// Who added, completed/reopened, edited, and deleted each task. Same
// Prepress/Admin gate as the checklist itself. Read-only — writes
// happen as a side effect of the checklist's own POST/PATCH/DELETE
// handlers, not through this route. The table itself is capped at its
// 150 most recent rows by a trigger (029_prepress_todo_logs_trim.sql),
// so this never needs to page.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { parseDepartment, canDeptManageJobSeparation } from '@/lib/constants/departments';

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dept = parseDepartment(user.user_metadata?.department);
  if (!dept) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });

  if (!canDeptManageJobSeparation(dept)) {
    return NextResponse.json(
      { error: 'Only Prepress or Admin can view this history' },
      { status: 403 }
    );
  }

  const q = new URL(request.url).searchParams.get('q')?.trim();

  let query = supabase
    .from('prepress_todo_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(150);

  if (q) {
    // Escape ilike wildcards so a typed % or _ matches literally, then
    // strip comma/paren — the .or() filter syntax's own separators —
    // before wrapping as a substring match across the searchable columns.
    const pattern = `%${q.replace(/[%_]/g, '\\$&').replace(/[,()]/g, ' ')}%`;
    query = query.or(`task.ilike.${pattern},actor_email.ilike.${pattern},actor_department.ilike.${pattern}`);
  }

  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ logs: data ?? [] });
}
