// src/app/api/jobs/[id]/print-runs/route.ts
// ============================================================
// GET  /api/jobs/[id]/print-runs — list all runs for a job
// POST /api/jobs/[id]/print-runs — create a new print run
//
// A run is created when Production finishes printing a cycle
// (PrintRunModal) or clicks "Start Next Print Run".
// run_number is auto-assigned by the DB trigger from migration 003.
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

  const { data, error } = await supabase
    .from('print_runs')
    .select('*')
    .eq('job_id', id)
    .order('run_number');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ print_runs: data ?? [] });
}

// ── POST ──────────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dept = parseDepartment(user.user_metadata?.department);
  if (!dept) return NextResponse.json({ error: 'Invalid department in token' }, { status: 403 });

  // Print runs are created by Production (printing is their stage) or Admin
  if (dept !== 'Production' && dept !== 'Admin') {
    return NextResponse.json(
      { error: 'Only Production or Admin can create print runs' },
      { status: 403 }
    );
  }

  const body: {
    qty_this_run?: number;
    more_runs?:    boolean;
    notes?:        string;
  } = await request.json();

  const qtyThisRun = body.qty_this_run;
  const moreRuns   = body.more_runs ?? false;

  if (!qtyThisRun || qtyThisRun <= 0) {
    return NextResponse.json(
      { error: 'qty_this_run must be a positive number' },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // ── Fetch job + validate ──
  const { data: job, error: jobError } = await admin
    .from('jobs')
    .select('*')
    .eq('id', id)
    .single();

  if (jobError || !job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }
  if (job.is_closed) {
    return NextResponse.json({ error: 'Cannot add print runs to a closed PO' }, { status: 400 });
  }
  if (!job.label_qty) {
    return NextResponse.json(
      { error: 'Job has no label quantity set — add label_qty before recording print runs' },
      { status: 400 }
    );
  }

  // Only one run can be in the pipeline at a time
  const { data: activeRun } = await admin
    .from('print_runs')
    .select('id, run_number, current_stage')
    .eq('job_id', id)
    .eq('status', 'in_progress')
    .maybeSingle();

  if (activeRun) {
    return NextResponse.json(
      { error: `Run #${activeRun.run_number} is still in progress (${activeRun.current_stage}). Dispatch it before starting a new run.` },
      { status: 409 }
    );
  }

  // ── Quantity math — server recomputes, never trusts the client ──
  const remainingBefore = job.label_qty - (job.total_qty_dispatched ?? 0);

  if (qtyThisRun > remainingBefore) {
    return NextResponse.json(
      { error: `qty_this_run (${qtyThisRun}) exceeds remaining quantity (${remainingBefore})` },
      { status: 400 }
    );
  }

  const remainingAfter = remainingBefore - qtyThisRun;

  if (!moreRuns && remainingAfter !== 0) {
    return NextResponse.json(
      { error: 'more_runs=false requires qty_this_run to equal the full remaining quantity' },
      { status: 400 }
    );
  }

  // ── Create the run (run_number auto-assigned by DB trigger) ──
  const { data: printRun, error: runError } = await admin
    .from('print_runs')
    .insert({
      job_id:              id,
      qty_this_run:        qtyThisRun,
      qty_remaining_after: remainingAfter,
      current_stage:       'Printing',
      status:              'in_progress',
      notes:               body.notes?.trim() || null,
    })
    .select()
    .single();

  if (runError) {
    console.error('[POST print-runs] insert run:', runError);
    return NextResponse.json({ error: runError.message }, { status: 500 });
  }

  // ── Mark the job as multi-run if more cycles are coming ──
  if (moreRuns && !job.has_partial_runs) {
    await admin.from('jobs').update({ has_partial_runs: true }).eq('id', id);
  }

  // ── Audit log ──
  await admin
    .from('print_run_stage_logs')
    .insert({
      print_run_id: printRun.id,
      stage:        'Printing',
      changed_by:   user.id,
      notes:        body.notes?.trim() || null,
    });

  return NextResponse.json({ print_run: printRun }, { status: 201 });
}
