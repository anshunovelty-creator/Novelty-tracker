// src/app/api/settings/branding/logo/route.ts
// ============================================================
// POST /api/settings/branding/logo — upload a new company logo. Super-admin
// only. Stores it in the public "branding" storage bucket (migration 017)
// as logo.<ext>, overwriting whatever was there, and points
// company_settings.logo_url at the resulting public URL. A version query
// param busts any CDN/browser cache of the previous file at that same path.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions } from '@/lib/constants/departments';
import { invalidateBrandingCache } from '@/lib/branding';
import { deptKeyOf } from '@/lib/identity';

export const runtime = 'nodejs';

const ALLOWED_TYPES: Record<string, string> = {
  'image/png':  'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB — this is a logo, not a photo library

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!perms?.isSuperAdmin) {
    return NextResponse.json({ error: 'Only Admin can change company settings' }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Logo must be under 2 MB' }, { status: 400 });
  }
  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    return NextResponse.json({ error: 'Logo must be PNG, JPEG, WebP, or SVG' }, { status: 400 });
  }

  const admin = createAdminClient();
  const path = `logo.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await admin.storage
    .from('branding')
    .upload(path, bytes, { contentType: file.type, upsert: true });
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const { data: publicUrlData } = admin.storage.from('branding').getPublicUrl(path);
  const logoUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;

  const { error: updateError } = await admin
    .from('company_settings')
    .update({ logo_url: logoUrl, updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  invalidateBrandingCache();

  return NextResponse.json({ logoUrl });
}
