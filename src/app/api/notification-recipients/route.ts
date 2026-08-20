// src/app/api/notification-recipients/route.ts
// ============================================================
// GET  /api/notification-recipients  — list internal dispatch-alert emails (Admin only)
// POST /api/notification-recipients  — add one (Admin only)
//
// Rows in internal_notification_recipients — mirrors the /api/team
// Admin-gating pattern. See migration 037.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseDepartment } from '@/lib/constants/departments';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function denyUnlessAdmin(): Promise<NextResponse | null> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dept = parseDepartment(user.user_metadata?.department);
  if (dept !== 'Admin') {
    return NextResponse.json({ error: 'Only Admin can manage dispatch alert recipients' }, { status: 403 });
  }
  return null;
}

export async function GET() {
  const denied = await denyUnlessAdmin();
  if (denied) return denied;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('internal_notification_recipients')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ recipients: data ?? [] });
}

export async function POST(request: NextRequest) {
  const denied = await denyUnlessAdmin();
  if (denied) return denied;

  const body = await request.json();
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });
  }
  const label = typeof body.label === 'string' ? body.label.trim() || null : null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('internal_notification_recipients')
    .insert({ email, label })
    .select('*')
    .single();

  if (error) {
    const message = error.code === '23505' ? 'That email is already on the list' : error.message;
    return NextResponse.json({ error: message }, { status: 409 });
  }

  return NextResponse.json({ recipient: data }, { status: 201 });
}
