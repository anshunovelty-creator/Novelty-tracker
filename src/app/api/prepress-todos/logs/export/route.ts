// src/app/api/prepress-todos/logs/export/route.ts
// ============================================================
// GET /api/prepress-todos/logs/export[?q=foo] — CSV download of the
// checklist's audit trail. Pulls up to the full 1000-row retention
// pool (029_prepress_todo_logs_trim.sql) rather than the 150 the
// panel's History view shows on screen, so the team can archive
// everything before older rows roll off the auto-trim. Prepress or
// Admin only, same gate as the checklist itself.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { parseDepartment, canDeptManageJobSeparation } from '@/lib/constants/departments';
import { toCsv, csvTimestamp, istDateStamp, type CsvColumn } from '@/lib/export/csv';
import type { PrepressTodoLog } from '@/lib/types';

const ACTION_LABELS: Record<PrepressTodoLog['action'], string> = {
  created:   'Added',
  completed: 'Completed',
  reopened:  'Reopened',
  edited:    'Edited',
  deleted:   'Deleted',
};

const COLUMNS: CsvColumn<PrepressTodoLog>[] = [
  { header: 'Task',        value: (l) => l.task },
  { header: 'Action',      value: (l) => ACTION_LABELS[l.action] },
  { header: 'Actor Email', value: (l) => l.actor_email },
  { header: 'Department',  value: (l) => l.actor_department },
  { header: 'When',        value: (l) => csvTimestamp(l.created_at) },
];

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dept = parseDepartment(user.user_metadata?.department);
  if (!dept) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });

  if (!canDeptManageJobSeparation(dept)) {
    return NextResponse.json(
      { error: 'Only Prepress or Admin can export this history' },
      { status: 403 }
    );
  }

  const q = new URL(request.url).searchParams.get('q')?.trim();

  let query = supabase
    .from('prepress_todo_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1000);

  if (q) {
    const pattern = `%${q.replace(/[%_]/g, '\\$&').replace(/[,()]/g, ' ')}%`;
    query = query.or(`task.ilike.${pattern},actor_email.ilike.${pattern},actor_department.ilike.${pattern}`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const csv      = toCsv(data ?? [], COLUMNS);
  const filename = `prepress-todo-history-${istDateStamp()}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type':        'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control':       'no-store',
      'X-Export-Filename':   filename,
      'Access-Control-Expose-Headers': 'X-Export-Filename',
    },
  });
}
