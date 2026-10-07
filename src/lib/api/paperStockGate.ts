// src/lib/api/paperStockGate.ts
// The one auth check every /api/paper-stock route starts with. Reading the
// stock (and issuing it to a job) needs BOM access — the stock lives inside
// the BOM section. Receiving, adjusting and removing rolls also needs
// paper_stock_manage.

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import {
  getDeptPermissions, canDeptUseBOM, canDeptManagePaperStock, type DeptPermissions,
} from '@/lib/constants/departments';
import { deptKeyOf } from '@/lib/identity';

type Gate =
  | { error: NextResponse }
  | { user: { email?: string | null }; perms: DeptPermissions; by: string; supabase: Awaited<ReturnType<typeof createServerSupabaseClient>> };

export async function requirePaperStock(level: 'use' | 'manage'): Promise<Gate> {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!perms || !canDeptUseBOM(perms)) {
    return { error: NextResponse.json({ error: 'Bill of Material access required' }, { status: 403 }) };
  }
  if (level === 'manage' && !canDeptManagePaperStock(perms)) {
    return { error: NextResponse.json({ error: 'You do not have permission to change paper stock' }, { status: 403 }) };
  }
  return { user, perms, by: user.email ?? perms.key, supabase };
}

export function text(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

/** A positive number rounded to 2 dp, or null. */
export function positive(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

/** Postgres RAISE messages from the stock functions are written for people — pass them through. */
export function rpcError(error: { code?: string; message: string }): NextResponse {
  const friendly = error.code === 'P0001' || error.code === '22023';
  return NextResponse.json(
    { error: error.message || 'Stock update failed' },
    { status: error.code === 'P0002' ? 404 : friendly ? 409 : 500 },
  );
}
