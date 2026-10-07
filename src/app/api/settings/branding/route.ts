// src/app/api/settings/branding/route.ts
// ============================================================
// PATCH /api/settings/branding — update the singleton company_settings row
// (name, address, support email, return address, etc). Super-admin only,
// same gate as /api/departments. See src/lib/branding.ts for how this row
// is read back everywhere else in the app.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions } from '@/lib/constants/departments';
import { invalidateBrandingCache } from '@/lib/branding';
import { deptKeyOf } from '@/lib/identity';

async function requireSuperAdmin() {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;

  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!perms?.isSuperAdmin) {
    return { error: NextResponse.json({ error: 'Only Admin can change company settings' }, { status: 403 }) } as const;
  }
  return {} as const;
}

const FIELD_MAP: Record<string, string> = {
  name:           'company_name',
  shortName:      'company_short_name',
  productionName: 'company_production_name',
  address:        'address',
  supportEmail:   'support_email',
  returnAddress:  'return_address',
};

export async function PATCH(request: NextRequest) {
  const gate = await requireSuperAdmin();
  if ('error' in gate) return gate.error;

  const body = await request.json();
  const update: Record<string, string> = {};

  for (const [key, column] of Object.entries(FIELD_MAP)) {
    if (typeof body[key] === 'string' && body[key].trim()) {
      update[column] = body[key].trim();
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('company_settings')
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq('id', 1)
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  invalidateBrandingCache();

  return NextResponse.json({ settings: data });
}
