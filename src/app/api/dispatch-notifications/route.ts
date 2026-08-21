// src/app/api/dispatch-notifications/route.ts
// GET /api/dispatch-notifications — pending dispatch events grouped by
// party, for the "Dispatch Emails" panel. Dispatch/Admin only.

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptManageDispatchNotifications } from '@/lib/constants/departments';
import type { PendingDispatchNotification, PendingDispatchGroup } from '@/lib/types';

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!canDeptManageDispatchNotifications(perms)) {
    return NextResponse.json({ error: 'Only Dispatch/Admin can view dispatch notifications' }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('pending_dispatch_notifications')
    .select('*')
    .is('notified_at', null)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as PendingDispatchNotification[];
  const groups = new Map<string, PendingDispatchNotification[]>();
  for (const row of rows) {
    const list = groups.get(row.party) ?? [];
    list.push(row);
    groups.set(row.party, list);
  }

  const result: PendingDispatchGroup[] = Array.from(groups.entries())
    .map(([party, items]) => ({ party, items }))
    .sort((a, b) => a.party.localeCompare(b.party));

  return NextResponse.json({ groups: result });
}
