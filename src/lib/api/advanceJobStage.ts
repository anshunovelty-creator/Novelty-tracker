// src/lib/api/advanceJobStage.ts
// ============================================================
// Machine board → job stage sync.
//
// Pressing Start / Complete on a machine queue item IS the production update,
// so the job's stage follows automatically instead of Production recording the
// same work twice (Start → "In Printing", Complete → "Slitting").
//
// Scope is deliberately narrow: only the two Production pipeline stages, which
// need none of the extra machinery in /api/jobs/[id]/status — neither is in
// NOTIFICATION_TRIGGER_STAGES, neither is a DISPATCH_STAGES member, neither can
// close a PO, and neither is ever skipped for Repeat jobs. The target type is
// pinned to those two literals so this cannot quietly grow into a second, and
// divergent, copy of the status route. Anything else must go through
// /api/jobs/[id]/status.
//
// Never blocks the machine action: the press records physical work that already
// happened. If the stage cannot move (prerequisite not reached, PO closed,
// scheduled-release job) the caller still succeeds and reports why.
// ============================================================

import { createAdminClient } from '@/lib/supabase/admin';
import { canDeptSetStage } from '@/lib/constants/departments';
import { getPrerequisite, getVisibleStages, stageIndex } from '@/lib/constants/stages';
import type { DeptPermissions } from '@/lib/constants/departments';
import type { Stage } from '@/lib/constants/stages';

/** The only stages this helper may set — see the scope note above. */
export type MachineDrivenStage = 'In Printing' | 'Slitting';

export type StageSyncResult =
  | { advanced: true;  stage: MachineDrivenStage }
  | { advanced: false; reason: string };

export async function advanceJobStageFromMachine(
  jobId:  string,
  target: MachineDrivenStage,
  perms:  DeptPermissions,
  /** Shown in the internal audit comment, e.g. "Machine 2 · Start". */
  source: string
): Promise<StageSyncResult> {
  const admin = createAdminClient();

  const { data: job } = await admin
    .from('jobs')
    .select('id, status, job_type, is_closed, is_scheduled_release, printing_method')
    .eq('id', jobId)
    .maybeSingle();

  if (!job)          return { advanced: false, reason: 'job not found' };
  if (job.is_closed) return { advanced: false, reason: 'the PO is closed' };

  // Scheduled-release jobs run printing onward per release through the run
  // pipeline; /api/jobs/[id]/status rejects job-level printing stages for them.
  if (job.is_scheduled_release) {
    return {
      advanced: false,
      reason: 'this is a scheduled-release job — advance the release in the Releases panel',
    };
  }

  // Pass printing_method so a department's printingMethodScope (e.g.
  // Unit1Admin → Offset only) is enforced here too — previously this path
  // called canDeptSetStage without it, so unit-scoped departments could
  // advance jobs outside their unit via the machine board.
  if (!canDeptSetStage(perms, target, job.printing_method)) {
    return { advanced: false, reason: `${perms.key} cannot set "${target}"` };
  }

  const currentStatus = job.status as Stage;
  const jobType = job.job_type as 'New' | 'Repeat' | 'Artwork Changed';

  // Forward-only. A reprint on a machine must not drag a job that already
  // reached QC or Packing back to In Printing. On Hold sits outside the
  // pipeline (index -1) and so counts as behind, meaning resuming work on a
  // held job does move it forward.
  if (stageIndex(currentStatus) >= stageIndex(target)) {
    return { advanced: false, reason: `job is already at "${currentStatus}"` };
  }

  // Same prerequisite rule as the status route: satisfied when the prerequisite
  // is the stage being left right now, otherwise it must carry a timestamp.
  const prereq = getPrerequisite(target, jobType);
  if (prereq && prereq !== currentStatus) {
    const { data: stamped } = await admin
      .from('job_stage_timestamps')
      .select('id')
      .eq('job_id', jobId)
      .eq('stage', prereq)
      .maybeSingle();

    if (!stamped) {
      return { advanced: false, reason: `"${prereq}" has not been completed yet` };
    }
  }

  const now = new Date().toISOString();

  // Reaching a pipeline stage means every earlier visible stage is done too.
  // ignoreDuplicates keeps the original completed_at on stages already stamped.
  const visibleStages = getVisibleStages(jobType);
  const idx = visibleStages.indexOf(target);
  const stagesToStamp = idx >= 0 ? visibleStages.slice(0, idx + 1) : [target];

  await admin
    .from('job_stage_timestamps')
    .upsert(
      stagesToStamp.map((stage) => ({ job_id: jobId, stage, completed_at: now })),
      { onConflict: 'job_id,stage', ignoreDuplicates: true }
    );

  const { error: updateError } = await admin
    .from('jobs')
    .update({ status: target })
    .eq('id', jobId);

  if (updateError) {
    console.error('[advanceJobStageFromMachine] update job:', updateError);
    return { advanced: false, reason: 'could not update the job' };
  }

  // remark stays null: job_status_logs.remark reaches the client tracking portal
  // through the client_status_logs view, and "advanced from the machine board"
  // is internal vocabulary. Provenance goes to stage_comments, which the portal
  // never reads.
  await admin
    .from('job_status_logs')
    .insert({
      job_id:          jobId,
      status:          target,
      changed_by_dept: perms.key,
      changed_at:      now,
      remark:          null,
      qty_dispatched:  null,
    });

  await admin
    .from('stage_comments')
    .insert({
      job_id:     jobId,
      stage:      target,
      comment:    `[Auto] Stage set from the machine board — ${source}.`,
      created_by: perms.key,
    });

  return { advanced: true, stage: target };
}
