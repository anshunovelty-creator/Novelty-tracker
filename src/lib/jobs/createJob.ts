// src/lib/jobs/createJob.ts
// Shared job-insert logic used by POST /api/jobs (the Add Job form) and
// POST /api/job-separations/[id]/create-job (the "Add Job" button on a Job
// Separation row) — kept as one function so the two entry points can never
// drift on what a newly created job looks like.

import { getVisibleStages } from '@/lib/constants/stages';
import type { AddJobFormData, Job } from '@/lib/types';
import type { Department } from '@/lib/constants/departments';
import type { createAdminClient } from '@/lib/supabase/admin';

type AdminClient = ReturnType<typeof createAdminClient>;

export type CreateJobResult =
  | { ok: true; job: Job }
  | { ok: false; status: number; error: string };

export async function createJobRecord(
  admin: AdminClient,
  dept: Department,
  body: AddJobFormData,
): Promise<CreateJobResult> {
  if (!body.po_number?.trim()) {
    return { ok: false, status: 400, error: 'PO number is required' };
  }
  if (!body.party?.trim()) {
    return { ok: false, status: 400, error: 'Party name is required' };
  }

  // ── Resolve printing method from the chosen unit ──
  // Each unit runs exactly one process (Unit-1 Offset, Unit-2 Flexo), so the
  // Add Job form asks only for the unit. The unit row is the single source of
  // truth for the method — deriving it here keeps the two from ever
  // disagreeing, which a second form field made possible.
  let printingMethod: string = body.printing_method || 'Flexo';
  if (body.printing_unit_id) {
    const { data: unit, error: unitError } = await admin
      .from('printing_units')
      .select('printing_method')
      .eq('id', body.printing_unit_id)
      .single();

    if (unitError || !unit) {
      return { ok: false, status: 400, error: 'Selected printing unit was not found' };
    }
    printingMethod = unit.printing_method;
  }

  // ── Insert job row ──
  const jobPayload = {
    po_number:            body.po_number.trim(),
    pm_code:              body.pm_code?.trim() || null,
    party:                body.party.trim(),
    job_name:             body.job_name?.trim() || null,
    label_qty:            body.label_qty || null,
    po_date:              body.po_date || null,
    delivery_date:        body.delivery_date || null,
    status:               body.status || 'PO Received',
    job_type:             body.job_type || 'New',
    urgent:               body.urgent ?? false,
    urgent_priority:      body.urgent ? (body.urgent_priority ?? null) : null,
    notes:                body.notes?.trim() || null,
    dispatched_qty:       0,
    is_scheduled_release: body.is_scheduled_release ?? false,
    is_closed:            false,
    printing_method:      printingMethod,
    // null is meaningful: it tells the set_job_printing_unit trigger to
    // pick the default unit for the chosen method.
    printing_unit_id:     body.printing_unit_id || null,
  };

  const { data: job, error: jobError } = await admin
    .from('jobs')
    .insert(jobPayload)
    .select()
    .single();

  if (jobError) {
    console.error('[createJobRecord] insert job:', jobError);
    return { ok: false, status: 500, error: jobError.message };
  }

  // ── Write initial status log ──
  const { error: logError } = await admin
    .from('job_status_logs')
    .insert({
      job_id:          job.id,
      status:          job.status,
      changed_by_dept: dept,
      remark:          null,
      qty_dispatched:  null,
    });

  if (logError) {
    console.error('[createJobRecord] insert log:', logError);
    // Don't fail the whole request for a log write failure — job is created
  }

  // ── Write initial stage timestamps ──
  // A job created at a mid-pipeline stage (e.g. Repeat at 'In Printing') has
  // logically passed all earlier visible stages — stamp them all so the
  // history shows ticks and prerequisite checks pass.
  const visibleStages = getVisibleStages(job.job_type);
  const initialIdx = visibleStages.indexOf(job.status);
  const stagesToStamp = initialIdx >= 0
    ? visibleStages.slice(0, initialIdx + 1)
    : [job.status];

  await admin
    .from('job_stage_timestamps')
    .insert(
      stagesToStamp.map((stage) => ({
        job_id:       job.id,
        stage,
        completed_at: new Date().toISOString(),
      }))
    );

  // ── Insert dispatch schedule rows (if scheduled release) ──
  if (body.is_scheduled_release && body.scheduled_releases?.length) {
    const scheduleRows = body.scheduled_releases.map((r) => ({
      job_id:         job.id,
      release_number: r.release_number,
      planned_qty:    r.planned_qty,
      planned_date:   r.planned_date,
      status:         'Pending' as const,
    }));

    const { error: scheduleError } = await admin
      .from('dispatch_schedules')
      .insert(scheduleRows);

    if (scheduleError) {
      console.error('[createJobRecord] insert schedules:', scheduleError);
    }
  }

  return { ok: true, job };
}
