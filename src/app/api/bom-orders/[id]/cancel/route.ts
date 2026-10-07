// src/app/api/bom-orders/[id]/cancel/route.ts
// ============================================================
// POST /api/bom-orders/[id]/cancel — undo an order placed by mistake. Its
//      requests go back to Awaiting. bom_decide; only before it's received.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptDecideBOM } from '@/lib/constants/departments';
import { rpcError } from '@/lib/api/paperStockGate';
import { deptKeyOf } from '@/lib/identity';

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!perms || !canDeptDecideBOM(perms)) {
    return NextResponse.json({ error: 'Only Admin can cancel an order' }, { status: 403 });
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc('cancel_material_order', { p_order_id: id, p_by: user.email ?? perms.key });
  if (error) return rpcError(error);

  return NextResponse.json({ success: true });
}
