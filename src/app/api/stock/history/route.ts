// src/app/api/stock/history/route.ts
// ============================================================
// DELETE /api/stock/history — permanently clear dispatched-out stock rows
//                             (the history view). Live shelf stock is
//                             never touched. Admin only.
// ============================================================

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions } from '@/lib/constants/departments';
import { deptKeyOf } from '@/lib/identity';

export async function DELETE() {
  const supabase = await createServerSupabaseClient();

  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!perms?.isSuperAdmin) {
    return NextResponse.json({ error: 'Only Admin can clear stock history' }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('label_stock')
    .delete()
    .eq('is_dispatched', true)
    .select('id');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ cleared: data?.length ?? 0 });
}
