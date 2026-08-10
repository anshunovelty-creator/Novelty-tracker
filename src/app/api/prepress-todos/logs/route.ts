// src/app/api/prepress-todos/logs/route.ts
// ============================================================
// GET /api/prepress-todos/logs — audit trail for the checklist: who
// added, completed/reopened, edited, and deleted each task. Same
// Prepress/Admin gate as the checklist itself. Read-only — writes
// happen as a side effect of the checklist's own POST/PATCH/DELETE
// handlers, not through this route.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { parseDepartment, canDeptManageJobSeparation } from '@/lib/constants/departments';

export async function GET(_request: NextRequest) {
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

  const { data, error } = await supabase
    .from('prepress_todo_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ logs: data ?? [] });
}
