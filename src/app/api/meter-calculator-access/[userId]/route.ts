// src/app/api/meter-calculator-access/[userId]/route.ts
// ============================================================
// DELETE /api/meter-calculator-access/[userId] — revoke one person's
//                                                 Meter Calculator access
//                                                 (super-admin only)
// ============================================================

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions } from '@/lib/constants/departments';

type Params = { params: Promise<{ userId: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  const { userId } = await params;

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!perms?.isSuperAdmin) {
    return NextResponse.json({ error: 'Only Admin can manage Meter Calculator access' }, { status: 403 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from('meter_calculator_access').delete().eq('user_id', userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
