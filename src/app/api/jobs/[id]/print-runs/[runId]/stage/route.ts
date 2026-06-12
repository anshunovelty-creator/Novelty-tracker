// src/app/api/jobs/[id]/print-runs/[runId]/stage/route.ts
// ============================================================
// POST — advance a print run through its stages:
//   Printing → QC → Packing → Dispatched (strictly sequential)
//
// On Dispatched:
//   - print_run.status = 'dispatched', dispatched_at = now
//   - jobs.total_qty_dispatched += qty_this_run
// Every change is appended to print_run_stage_logs.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseDepartment } from '@/lib/constants/departments';
import type { PrintRunStage } from '@/lib/types';
import type { Department } from '@/lib/constants/departments';

type Params = { params: Promise<{ id: string; runId: string }> };

const RUN_STAGE_ORDER: PrintRunStage[] = ['Printing', 'QC', 'Packing', 'Dispatched'];

// Which departments may set each run stage (Admin always allowed)
const RUN_STAGE_DEPTS: Record<PrintRunStage, Department[]> = {
  Printing:   ['Production'],
  QC:         ['QC'],
  Packing:    ['Dispatch'],
  Dispatched: ['Dispatch'],
};

export async function POST(request: NextRequest, { params }: Params) {
  const { id, runId } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dept = parseDepartment(user.user_metadata?.department);
  if (!dept) return NextResponse.json({ error: 'Invalid department in token' }, { status: 403 });

  const body: { new_stage?: PrintRunStage; notes?: string } = await request.json();
  const newStage = body.new_stage;

  if (!newStage || !RUN_STAGE_ORDER.includes(newStage)) {
    return NextResponse.json(
      { error: `new_stage must be one of: ${RUN_STAGE_ORDER.join(', ')}` },
      { status: 400 }
    );
  }

  // ── Department permission ──
  if (dept !== 'Admin' && !RUN_STAGE_DEPTS[newStage].includes(dept)) {
    return NextResponse.json(
      { error: `${dept} department cannot set run stage to "${newStage}"` },
      { status: 403 }
    );
  }

  const admin = createAdminClient();

  // ── Fetch run + verify it belongs to this job ──
  const { data: run, error: runError } = await admin
    .from('print_runs')
    .select('*')
    .eq('id', runId)
    .eq('job_id', id)
    .single();

  if (runError || !run) {
    return NextResponse.json({ error: 'Print run not found for this job' }, { status: 404 });
  }
  if (run.status === 'dispatched') {
    return NextResponse.json({ error: 'This run is already dispatched' }, { status: 400 });
  }

  // ── Strict sequential progression ──
  const currentIdx = RUN_STAGE_ORDER.indexOf(run.current_stage as PrintRunStage);
  const targetIdx  = RUN_STAGE_ORDER.indexOf(newStage);

  if (targetIdx !== currentIdx + 1) {
    return NextResponse.json(
      {
        error: `Invalid progression: "${run.current_stage}" → "${newStage}". ` +
               `Next stage must be "${RUN_STAGE_ORDER[currentIdx + 1] ?? 'none — run is complete'}".`,
      },
      { status: 409 }
    );
  }

  const now = new Date().toISOString();

  // ── Update the run ──
  const runUpdate: Record<string, unknown> = { current_stage: newStage };
  if (newStage === 'Dispatched') {
    runUpdate.status        = 'dispatched';
    runUpdate.dispatched_at = now;
  }

  const { data: updatedRun, error: updateError } = await admin
    .from('print_runs')
    .update(runUpdate)
    .eq('id', runId)
    .select()
    .single();

  if (updateError) {
    console.error('[POST print-run stage] update run:', updateError);
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // ── On dispatch: add this run's qty to the job total ──
  if (newStage === 'Dispatched') {
    const { data: job } = await admin
      .from('jobs')
      .select('total_qty_dispatched')
      .eq('id', id)
      .single();

    await admin
      .from('jobs')
      .update({ total_qty_dispatched: (job?.total_qty_dispatched ?? 0) + run.qty_this_run })
      .eq('id', id);
  }

  // ── Audit log ──
  await admin
    .from('print_run_stage_logs')
    .insert({
      print_run_id: runId,
      stage:        newStage,
      changed_by:   user.id,
      notes:        body.notes?.trim() || null,
    });

  return NextResponse.json({ print_run: updatedRun });
}
