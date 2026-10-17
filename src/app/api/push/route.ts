// src/app/api/push/route.ts
// ============================================================
// POST /api/push  { endpoint, keys: { p256dh, auth } }
//   Saves this browser's push subscription for the signed-in person
//   (push_subscriptions, migration 083). Sent on every admin load once
//   notifications are allowed (src/lib/pushClient.ts), so a device that
//   changes hands or gets a fresh subscription is always filed correctly.
//
// Middleware lets Viewers through here: it only writes their own device.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';

const str = (v: unknown, max: number) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const endpoint = str(body?.endpoint, 1000);
  const p256dh   = str(body?.keys?.p256dh, 200);
  const auth     = str(body?.keys?.auth, 100);
  if (!endpoint?.startsWith('https://') || !p256dh || !auth) {
    return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
  }

  const { error } = await createAdminClient()
    .from('push_subscriptions')
    .upsert({ endpoint, p256dh, auth, user_id: user.id, user_email: user.email });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
