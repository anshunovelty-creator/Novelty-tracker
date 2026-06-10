// src/app/api/jobs/[id]/route.ts
// ============================================================
// GET    /api/jobs/[id]  — full job detail with related data
// PATCH  /api/jobs/[id]  — update job fields (delivery date, notes, etc.)
// DELETE /api/jobs/[id]  — Admin only
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseDepartment } from '@/lib/constants/departments';

type Params = { params: Promise<{ id: string }> };

// ── GET ───────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Fetch job + all related data in parallel
  const [jobRes, timestampsRes, logsRes, commentsRes, schedulesRes] = await Promise.all([
    supabase.from('jobs').select('*').eq('id', id).single(),
    supabase.from('job_stage_timestamps').select('*').eq('job_id', id).order('completed_at'),
    supabase.from('job_status_logs').select('*').eq('job_id', id).order('changed_at'),
    supabase.from('stage_comments').select('*').eq('job_id', id).order('created_at'),
    supabase.from('dispatch_schedules').select('*').eq('job_id', id).order('release_number'),
  ]);

  if (jobRes.error) {
    if (jobRes.error.code === 'PGRST116') {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }
    return NextResponse.json({ error: jobRes.error.message }, { status: 500 });
  }

  return NextResponse.json({
    job: {
      ...jobRes.data,
      stage_timestamps:  timestampsRes.data ?? [],
      status_logs:       logsRes.data ?? [],
      stage_comments:    commentsRes.data ?? [],
      dispatch_schedules: schedulesRes.data ?? [],
    },
  });
}

// ── PATCH ─────────────────────────────────────────────────────
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dept = parseDepartment(user.user_metadata?.department);
  if (!dept) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });

  const body = await request.json();

  // Whitelist of fields that can be PATCHed via this endpoint
  // (status changes go through /api/jobs/[id]/status instead)
  const allowedFields = [
    'delivery_date',
    'notes',
    'urgent',
    'urgent_priority',
    'pm_code',
    'job_name',
    'label_qty',
  ] as const;

  // Delivery date edit: only Dispatch or Admin
  if ('delivery_date' in body && dept !== 'Dispatch' && dept !== 'Admin') {
    return NextResponse.json(
      { error: 'Only Dispatch or Admin can edit delivery date' },
      { status: 403 }
    );
  }

  const updates: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (field in body) updates[field] = body[field];
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('jobs')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ job: data });
}

// ── DELETE ────────────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dept = parseDepartment(user.user_metadata?.department);
  if (dept !== 'Admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from('jobs').delete().eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
