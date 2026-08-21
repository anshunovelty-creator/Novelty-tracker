// src/app/api/jobs/[id]/comments/route.ts
// ============================================================
// GET  /api/jobs/[id]/comments?stage=Quality+Check  — fetch comments for a stage
// POST /api/jobs/[id]/comments                       — add a comment
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions } from '@/lib/constants/departments';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const stage = new URL(request.url).searchParams.get('stage');

  let query = supabase
    .from('stage_comments')
    .select('*')
    .eq('job_id', id)
    .order('created_at', { ascending: true });

  if (stage) query = query.eq('stage', stage);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ comments: data });
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!perms) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });

  const body = await request.json();
  const { stage, comment } = body;

  if (!stage?.trim() || !comment?.trim()) {
    return NextResponse.json(
      { error: 'stage and comment are required' },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('stage_comments')
    .insert({
      job_id:           id,
      stage:            stage.trim(),
      comment:          comment.trim(),
      created_by:       perms.key,
      created_by_email: user.email ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ comment: data }, { status: 201 });
}
