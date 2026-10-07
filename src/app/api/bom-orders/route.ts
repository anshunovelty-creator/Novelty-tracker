// src/app/api/bom-orders/route.ts
// ============================================================
// GET  /api/bom-orders — Admin's purchases, newest first, each with the
//      requests it answers (and their jobs). ?status=ordered|received|
//      cancelled|all (default ordered). bom_use.
// POST /api/bom-orders — place an order: { request_ids, ordered_meter }.
//      bom_decide. The requests must be awaiting, and share one material
//      and width; ordered_meter is what's actually being bought — usually
//      more than was requested, and the surplus goes to stock on receipt.
//      See place_material_order in migration 064.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptUseBOM, canDeptDecideBOM } from '@/lib/constants/departments';
import { BOM_JOB_SUMMARY_SELECT } from '@/lib/bom';
import { positive, rpcError } from '@/lib/api/paperStockGate';
import { deptKeyOf } from '@/lib/identity';

const STATUSES = ['ordered', 'received', 'cancelled'] as const;

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!canDeptUseBOM(perms)) {
    return NextResponse.json({ error: 'Bill of Material access required' }, { status: 403 });
  }

  const status = request.nextUrl.searchParams.get('status') ?? 'ordered';
  let query = supabase
    .from('bom_material_orders')
    .select(`*, requests:bom_material_requests(*, ${BOM_JOB_SUMMARY_SELECT})`)
    .order('created_at', { ascending: false });
  if ((STATUSES as readonly string[]).includes(status)) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const orders = (data ?? []).map((o) => ({
    ...o,
    width_mm:       Number(o.width_mm),
    ordered_meter:  Number(o.ordered_meter),
    received_meter: o.received_meter === null ? null : Number(o.received_meter),
  }));
  return NextResponse.json({ orders });
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!perms || !canDeptDecideBOM(perms)) {
    return NextResponse.json({ error: 'Only Admin can place a material order' }, { status: 403 });
  }

  const body = await request.json();
  const ids: string[] = Array.isArray(body.request_ids)
    ? body.request_ids.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
    : [];
  if (ids.length === 0) return NextResponse.json({ error: 'Pick at least one request to order' }, { status: 400 });

  const meters = positive(body.ordered_meter);
  if (meters === null) return NextResponse.json({ error: 'Enter the metres you are ordering' }, { status: 400 });

  const admin = createAdminClient();
  const { data: orderId, error } = await admin.rpc('place_material_order', {
    p_request_ids:   ids,
    p_ordered_meter: meters,
    p_by:            user.email ?? perms.key,
  });
  if (error) return rpcError(error);

  const { data: order } = await admin.from('bom_material_orders').select('*').eq('id', orderId).single();
  return NextResponse.json({ order }, { status: 201 });
}
