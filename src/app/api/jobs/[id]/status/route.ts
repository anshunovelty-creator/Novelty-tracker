// src/app/api/jobs/[id]/status/route.ts
// ============================================================
// POST /api/jobs/[id]/status
//
// The core business logic route. Every status change goes through here.
// Responsibilities:
//   1. Authenticate + validate department permission for this stage
//   2. Refuse backward moves — the pipeline is a one-way ratchet. Admin may
//      revert with a written reason (override_backward), which also clears the
//      stage timestamps it walked back past.
//   3. Check sequential prerequisite (unless override = true)
//   4. Handle Repeat job stage-skip rules
//   5. Update jobs.status (and halt_remark / qc_remark if applicable)
//   6. Write job_stage_timestamps (mark stage as completed)
//   7. Write job_status_logs (permanent audit entry)
//   8. Handle dispatch qty (Partial Dispatch / Dispatched)
//   9. Write on_time_dispatch_log if status = Dispatched
//  10. Close PO if status = PO Closed
//  11. Trigger notifications (email + WhatsApp) for qualifying stages — not on a revert
//
// Idempotency-Key (optional header, a UUID): the same change sent twice is
// applied once. The dashboard sets it so a change replayed after a dropped
// connection — which may already have gone through — can't dispatch twice.
// See POST below and migration 072.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { upsertRemainingStock, clearRemainingStock, addExtraStock } from '@/lib/api/labelStock';
import { getDeptPermissions, canDeptSetStage, canDeptOverridePOClosed, deptNamesForStage } from '@/lib/constants/departments';
import { NOT_YOUR_STAGE, notYourStageTitle } from '@/lib/stageBlocked';
import { getPrerequisite, getVisibleStages, isStageSkipped, isPerReleaseStage, isBackwardMove, NOTIFICATION_TRIGGER_STAGES, DISPATCH_STAGES } from '@/lib/constants/stages';
import { toMonthKey } from '@/lib/utils';
import type { Stage } from '@/lib/constants/stages';
import type { StatusChangePayload, Job } from '@/lib/types';
import { deptKeyOf } from '@/lib/identity';

type Params = { params: Promise<{ id: string }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const JOB_SELECT = '*, job_stage_timestamps(stage), printing_units(id, name, printing_method)';

// ── Duplicate guard ───────────────────────────────────────────
// Claims the Idempotency-Key before doing anything. A key already claimed
// means this change was applied (or is being applied) by an earlier send,
// so the answer is the job as it stands now — the same shape as success.
// A refused or failed change gives its key back, so a corrected retry with
// the same key can still go through.
//
// Fails open: no key, or no job_status_requests table yet (migration 072
// not applied), and the change is handled exactly as it was before.
export async function POST(request: NextRequest, ctx: Params) {
  const key = request.headers.get('idempotency-key')?.trim() ?? '';
  if (!key) return applyStatusChange(request, ctx);
  if (!UUID_RE.test(key)) {
    return NextResponse.json({ error: 'Idempotency-Key must be a UUID' }, { status: 400 });
  }

  const { id } = await ctx.params;
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const { error: claimError } = await admin
    .from('job_status_requests')
    .insert({ id: key, job_id: id, created_by: user.email ?? null });

  if (claimError?.code === '23505') {
    const { data: job, error } = await supabase.from('jobs').select(JOB_SELECT).eq('id', id).single();
    if (error || !job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    return NextResponse.json({ job, duplicate: true });
  }
  if (claimError) {
    // Missing table, or the job id doesn't exist (FK) — let the normal path
    // answer; it reports a bad job id properly.
    console.warn('[POST status] idempotency claim skipped:', claimError.code, claimError.message);
    return applyStatusChange(request, ctx);
  }

  let res: Response;
  try {
    res = await applyStatusChange(request, ctx);
  } catch (err) {
    await admin.from('job_status_requests').delete().eq('id', key);
    throw err;
  }
  if (!res.ok) await admin.from('job_status_requests').delete().eq('id', key);
  return res;
}

async function applyStatusChange(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  // ── 1. Auth ───────────────────────────────────────────────
  const user = await getClaimsUser(supabase);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!perms) {
    return NextResponse.json({ error: 'Invalid department in token' }, { status: 403 });
  }

  const body: StatusChangePayload = await request.json();
  const {
    new_status, remark, qty_dispatched, override_prerequisite, override_backward, override_remark,
    // Label stock (optional): Dispatch confirms what is left on the shelf at a
    // partial dispatch, and reports any surplus printed at a full dispatch.
    stock_remaining_qty, stock_remaining_location, extra_label_qty, extra_label_location, extra_label_remark,
  } = body;

  if (!new_status) {
    return NextResponse.json({ error: 'new_status is required' }, { status: 400 });
  }

  // Skipping prerequisites is a broad "bypass validation" capability, kept
  // to the one true super-admin rather than independently grantable.
  if (override_prerequisite) {
    if (!perms.isSuperAdmin) {
      return NextResponse.json(
        { error: 'Only Admin can skip stage prerequisites' },
        { status: 403 }
      );
    }
    if (!override_remark?.trim()) {
      return NextResponse.json(
        { error: 'A remark is required when skipping a prerequisite stage' },
        { status: 400 }
      );
    }
  }

  // Reverting a job to an earlier stage rewrites history the client portal has
  // already been shown, so it carries the same two conditions as a prerequisite
  // skip: super-admin only, and a written reason for the audit trail.
  if (override_backward) {
    if (!perms.isSuperAdmin) {
      return NextResponse.json(
        { error: 'Only Admin can move a job back to an earlier stage' },
        { status: 403 }
      );
    }
    if (!override_remark?.trim()) {
      return NextResponse.json(
        { error: 'A remark is required when moving a job back to an earlier stage' },
        { status: 400 }
      );
    }
  }

  // ── 2. Department permission check ────────────────────────
  // Says who CAN, so the person refused knows whom to tell — the jobs table
  // turns this into the "not your stage" toast with a Leave a note button.
  if (!canDeptSetStage(perms, new_status)) {
    return NextResponse.json(
      {
        error:         notYourStageTitle(await deptNamesForStage(new_status), new_status),
        code:          NOT_YOUR_STAGE,
        signed_in_as:  perms.displayName,
      },
      { status: 403 }
    );
  }

  const admin = createAdminClient();

  // ── 3. Fetch current job ──────────────────────────────────
  const { data: job, error: jobError } = await admin
    .from('jobs')
    .select('*')
    .eq('id', id)
    .single();

  if (jobError || !job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  if (job.is_closed) {
    return NextResponse.json({ error: 'Cannot update a closed PO' }, { status: 400 });
  }

  // A department's printing_method_scope (e.g. Unit1Admin → Offset only)
  // can't be checked above — the department-only check can't see the job
  // yet. Re-check now that we have it; this is the real enforcement point,
  // the dropdowns just mirror it for UX.
  if (!canDeptSetStage(perms, new_status, job.printing_method)) {
    return NextResponse.json(
      {
        error:        notYourStageTitle(await deptNamesForStage(new_status, job.printing_method), new_status)
                      + ` on ${job.printing_method} jobs`,
        code:         NOT_YOUR_STAGE,
        signed_in_as: perms.displayName,
      },
      { status: 403 }
    );
  }

  const jobType = job.job_type as 'New' | 'Repeat' | 'Artwork Changed';

  // Scheduled-release jobs advance printing/QC/dispatch per release through
  // the run pipeline — job-level updates stop after the once-per-job stages.
  if (job.is_scheduled_release && isPerReleaseStage(new_status)) {
    return NextResponse.json(
      { error: `"${new_status}" is updated per release for scheduled-release jobs — use the Releases panel on the job page.` },
      { status: 400 }
    );
  }

  // ── 4. Check Repeat job stage-skip rules ─────────────────
  if (isStageSkipped(new_status, jobType)) {
    return NextResponse.json(
      { error: `Stage "${new_status}" is not applicable for ${jobType} jobs` },
      { status: 400 }
    );
  }

  // ── 4b. Forward-only check ────────────────────────────────
  // The pipeline is a ratchet: work that has physically happened cannot
  // un-happen, and the prerequisite check below can never catch a reversal —
  // every earlier stage is stamped by definition, so "Packing → Plate Status"
  // sails straight through it. This is the guard that stops it.
  //
  // Same rule the machine board (advanceJobStageFromMachine) and the run
  // pipeline (print-runs/[runId]/stage) already enforce; the job-level route
  // was the one path still open.
  //
  // A held job is measured by the furthest stage it reached, so resuming it
  // returns to that stage without counting as a leap forward — see
  // effectiveStageIndex.
  let heldCompletedStages: Stage[] = [];
  if (job.status === 'On Hold') {
    const { data: stamps } = await admin
      .from('job_stage_timestamps')
      .select('stage')
      .eq('job_id', id);
    heldCompletedStages = (stamps ?? []).map((s) => s.stage as Stage);
  }

  const movingBackward = isBackwardMove(job.status as Stage, new_status, heldCompletedStages);

  if (movingBackward && !override_backward) {
    return NextResponse.json(
      {
        error:         'BACKWARD_MOVE_BLOCKED',
        current_stage: job.status,
        target_stage:  new_status,
      },
      { status: 409 }
    );
  }

  // Not even Admin may revert INTO a dispatch stage: setting Partial Dispatch
  // adds to dispatched_qty (see section 7), so landing on it a second time
  // would double-count goods that only left the building once. Reverting away
  // from a dispatch stage is fine — the shipment happened, and dispatched_qty
  // is left alone.
  if (movingBackward && DISPATCH_STAGES.includes(new_status)) {
    return NextResponse.json(
      { error: `Cannot move a job back to "${new_status}" — dispatched quantities cannot be re-recorded. Correct the quantity on the job instead.` },
      { status: 400 }
    );
  }

  // ── 5. Prerequisite check (unless On Hold or override) ───
  if (new_status !== 'On Hold' && !override_prerequisite) {
    const prereq = getPrerequisite(new_status, jobType);

    // Quality Check is a special case. Slitting is entered automatically the
    // instant Production finishes printing (see advanceJobStageFromMachine),
    // with no Postpress action at all — so job.status === 'Slitting' only
    // ever means slitting has started, not that Postpress is done with it.
    // QC needs Postpress's explicit confirmation instead of the usual
    // "reached the stage" check. See jobUpdate.slitting_confirmed_at below
    // for the manual-dropdown path, and POST /api/jobs/[id]/confirm-slitting
    // for the machine-board path.
    if (new_status === 'Quality Check') {
      if (!job.slitting_confirmed_at) {
        return NextResponse.json(
          {
            error:         'PREREQUISITE_MISSING',
            missing_stage: 'Slitting',
            target_stage:  new_status,
          },
          { status: 409 }
        );
      }
    } else if (prereq && prereq !== job.status) {
      // The prerequisite is satisfied if it's the stage being left right now —
      // moving from stage N to N+1 completes N by definition.
      const { data: prereqTimestamp } = await admin
        .from('job_stage_timestamps')
        .select('id')
        .eq('job_id', id)
        .eq('stage', prereq)
        .maybeSingle();

      if (!prereqTimestamp) {
        // Return the missing stage so the frontend can show the warning modal
        return NextResponse.json(
          {
            error:         'PREREQUISITE_MISSING',
            missing_stage: prereq,
            target_stage:  new_status,
          },
          { status: 409 }
        );
      }
    }
  }

  // ── 6. Validate dispatch-specific rules ──────────────────
  // Jobs using print runs dispatch per-run via /print-runs/[runId]/stage —
  // the classic dispatch stages would double-count quantities.
  if (job.has_partial_runs && (new_status === 'Partial Dispatch' || new_status === 'Dispatched')) {
    return NextResponse.json(
      { error: 'This job uses print runs. Dispatch each run from the Print Runs panel instead.' },
      { status: 400 }
    );
  }

  if (new_status === 'Partial Dispatch') {
    if (!qty_dispatched || qty_dispatched <= 0) {
      return NextResponse.json(
        { error: 'qty_dispatched is required for Partial Dispatch' },
        { status: 400 }
      );
    }
    if (job.label_qty && qty_dispatched > (job.label_qty - job.dispatched_qty)) {
      return NextResponse.json(
        { error: 'qty_dispatched exceeds remaining quantity' },
        { status: 400 }
      );
    }
  }

  if (new_status === 'On Hold' && !remark?.trim()) {
    return NextResponse.json(
      { error: 'halt_remark is required when placing On Hold' },
      { status: 400 }
    );
  }

  // ── 7. Build job update payload ───────────────────────────
  const now = new Date().toISOString();
  const jobUpdate: Record<string, unknown> = {
    status: new_status,
  };

  if (new_status === 'Slitting') {
    // Manually picking Slitting from the dropdown is a deliberate Postpress
    // (or Admin) action — canDeptSetStage already restricts who can do this
    // — so it counts as a real confirmation, same as every other stage's
    // "the department clicked it, so it's done" semantics. This only fills
    // the gap for the machine-board path, which bypasses this route
    // entirely (see POST /api/jobs/[id]/confirm-slitting for that one).
    jobUpdate.slitting_confirmed_at = now;
  }

  if (new_status === 'On Hold') {
    jobUpdate.halt_remark = remark?.trim() ?? null;
  } else if (new_status === 'Quality Check') {
    jobUpdate.qc_remark = remark?.trim() ?? null;
  } else if (remark?.trim() && (job as any).status === 'Quality Check' && new_status !== 'Partial Dispatch' && new_status !== 'Dispatched') {
    // (A dispatch remark is the vehicle note for the party's email, not QC's.)
    // Remark provided while advancing FROM Quality Check — persist as qc_remark
    jobUpdate.qc_remark = remark.trim();
  }

  if (new_status === 'Partial Dispatch' && qty_dispatched) {
    jobUpdate.dispatched_qty = (job.dispatched_qty ?? 0) + qty_dispatched;
    // remaining_qty is auto-calculated by DB trigger
  }

  if (new_status === 'Dispatched') {
    // Full dispatch: mark all remaining as dispatched
    jobUpdate.dispatched_qty = job.label_qty ?? job.dispatched_qty;
    // remaining_qty → 0 via trigger
  }

  if (new_status === 'PO Closed') {
    if (!canDeptOverridePOClosed(perms)) {
      return NextResponse.json({ error: 'Only Admin can close a PO' }, { status: 403 });
    }
    jobUpdate.is_closed = true;
  }

  // ── 8. Execute DB writes ──────────────────────────────────
  // (Supabase JS doesn't support true transactions from the edge —
  //  we write in dependency order; if a later write fails, the job
  //  is still updated but the log/timestamp may be missing.
  //  For production-critical atomicity, wrap these in a Postgres function.)
  //
  // The job goes first, and only if nobody changed it since step 3 read
  // it (updated_at is bumped by a trigger on every write). Without that,
  // two dispatches at the same moment each added to the same old
  // dispatched_qty and one vanished — and both passed the over-dispatch
  // check above. A refused save has written nothing yet.
  const { data: saved, error: updateError } = await admin
    .from('jobs')
    .update(jobUpdate)
    .eq('id', id)
    .eq('updated_at', job.updated_at)
    .select('id')
    .maybeSingle();

  if (updateError) {
    console.error('[POST status] update job:', updateError);
    // jobs_dispatched_qty_in_range (migration 073): the database's own
    // last word on dispatching more than the order.
    if (updateError.code === '23514') {
      return NextResponse.json({ error: 'That would dispatch more than this job\'s order' }, { status: 409 });
    }
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }
  if (!saved) {
    return NextResponse.json(
      { error: 'Someone else just changed this job — refresh and try again', code: 'JOB_CHANGED' },
      { status: 409 }
    );
  }

  // Stage timestamps next, then the job is re-read below with them joined
  // (the dropdown's ✓ marks), so the answer carries fresh data.
  // Reaching a pipeline stage means every earlier visible stage is complete
  // too, so backfill all of them up to and including the new stage.
  // ignoreDuplicates preserves original completed_at values for stages that
  // were already stamped.
  // On Hold / PO Closed are not pipeline stages — stamp only themselves.
  const visibleStages = getVisibleStages(jobType);
  const stageIdx = visibleStages.indexOf(new_status);
  const stagesToStamp = stageIdx >= 0
    ? visibleStages.slice(0, stageIdx + 1)
    : [new_status];

  const timestampWrites: PromiseLike<unknown>[] = [
    admin
      .from('job_stage_timestamps')
      .upsert(
        stagesToStamp.map((stage) => ({ job_id: id, stage, completed_at: now })),
        { onConflict: 'job_id,stage', ignoreDuplicates: true }
      ),
  ];

  // An approved revert un-completes the stages it walked back past. Without
  // this the job would read "Plate Status" while Packing and QC stayed stamped
  // — the ✓ marks, the progress bar and the client portal would all keep
  // showing it as nearly done. Only pipeline stages are cleared; an On Hold or
  // PO Closed stamp is history, not progress, and stays.
  // Runs alongside the upsert above: the two touch disjoint stage sets
  // (up to and including stageIdx vs. strictly after it).
  if (movingBackward && stageIdx >= 0) {
    const stagesAhead = visibleStages.slice(stageIdx + 1);
    if (stagesAhead.length > 0) {
      timestampWrites.push(
        admin
          .from('job_stage_timestamps')
          .delete()
          .eq('job_id', id)
          .in('stage', stagesAhead)
          .then(({ error }) => {
            if (error) console.error('[POST status] clear stages ahead:', error);
          })
      );
    }
  }

  await Promise.all(timestampWrites);

  const { data: updatedJob, error: rereadError } = await admin
    .from('jobs')
    .select(JOB_SELECT)
    .eq('id', id)
    .single();

  if (rereadError || !updatedJob) {
    console.error('[POST status] re-read job:', rereadError);
    return NextResponse.json({ error: rereadError?.message ?? 'Job not found' }, { status: 500 });
  }

  // ── Label stock side-effects ──────────────────────────────
  // Deliberately after the job update and deliberately non-blocking: the
  // dispatch is the physical truth. If the shelf record fails to keep up we
  // log it, but we never fail a dispatch that already happened.
  //
  //   Partial Dispatch → the balance of the run is still on the shelf.
  //                      Dispatch confirms the qty in the modal; we fall back
  //                      to the computed remainder if they sent nothing.
  //   Dispatched       → the balance left the building, so that row closes.
  //                      Any 'Extra' surplus reported is added, not cleared.
  const stockActor = user.email ?? perms.key;

  // Everything below depends only on updatedJob, not on each other, so the
  // writes run in parallel instead of one round-trip after another — the
  // whole block is awaited once, just before the response.
  const sideEffects: PromiseLike<unknown>[] = [];
  const logIfError = (label: string) => ({ error }: { error: unknown }) => {
    if (error) console.error(`[POST status] ${label}:`, error);
  };

  if (new_status === 'Partial Dispatch') {
    const computedRemaining = (updatedJob.label_qty ?? 0) - (updatedJob.dispatched_qty ?? 0);
    const remainingForStock = typeof stock_remaining_qty === 'number'
      ? stock_remaining_qty
      : computedRemaining;
    sideEffects.push(
      upsertRemainingStock(admin, updatedJob as Job, remainingForStock, stockActor, stock_remaining_location)
        .then(logIfError('remaining stock'))
    );
  }

  if (new_status === 'Dispatched') {
    // Clear-then-add stays sequential within its own chain: the surplus row
    // must not be touched by the clear.
    sideEffects.push((async () => {
      const { error } = await clearRemainingStock(admin, id, stockActor);
      if (error) console.error('[POST status] clear remaining stock:', error);

      if (typeof extra_label_qty === 'number' && extra_label_qty > 0) {
        const { error: extraErr } = await addExtraStock(
          admin, updatedJob as Job, extra_label_qty, stockActor,
          extra_label_location, extra_label_remark,
        );
        if (extraErr) console.error('[POST status] extra stock:', extraErr);
      }
    })());
  }

  // Write status log
  sideEffects.push(admin
    .from('job_status_logs')
    .insert({
      job_id:          id,
      status:          new_status,
      changed_by_dept: perms.key,
      changed_at:      now,
      remark:          new_status === 'On Hold' || new_status === 'Quality Check'
                         ? (remark?.trim() ?? null)
                         : null,
      qty_dispatched:  (new_status === 'Partial Dispatch' || new_status === 'Dispatched')
                         ? (qty_dispatched ?? updatedJob.dispatched_qty)
                         : null,
    })
    .then(logIfError('status log')));

  // Record the Admin's skip justification as an internal stage comment.
  // stage_comments are never exposed to the client portal.
  if (override_prerequisite && override_remark?.trim()) {
    sideEffects.push(admin
      .from('stage_comments')
      .insert({
        job_id:     id,
        stage:      new_status,
        comment:    `[Prerequisite skipped] ${override_remark.trim()}`,
        created_by: perms.key,
      })
      .then(logIfError('skip comment')));
  }

  // Same audit trail for a revert, and it records where the job came from —
  // job_status_logs alone would show the new stage with no sign that the job
  // had ever been further along.
  if (movingBackward && override_remark?.trim()) {
    sideEffects.push(admin
      .from('stage_comments')
      .insert({
        job_id:     id,
        stage:      new_status,
        comment:    `[Reverted from "${job.status}"] ${override_remark.trim()}`,
        created_by: perms.key,
      })
      .then(logIfError('revert comment')));
  }

  // Write on-time dispatch log if fully dispatched
  if (new_status === 'Dispatched') {
    const dispatchedAt = new Date();
    const deliveryDate = job.delivery_date ? new Date(job.delivery_date) : null;
    const isOnTime = deliveryDate
      ? dispatchedAt <= deliveryDate
      : null;

    sideEffects.push(admin
      .from('on_time_dispatch_log')
      .insert({
        job_id:        id,
        dispatched_at: dispatchedAt.toISOString(),
        delivery_date: job.delivery_date ?? null,
        is_on_time:    isOnTime,
        month_key:     toMonthKey(dispatchedAt),
      })
      .then(logIfError('on-time log')));
  }

  // ── 9. Fire notifications (non-blocking — don't await, don't fail request) ──
  // waitUntil keeps the serverless function alive until the sends settle;
  // a bare un-awaited fetch can be frozen mid-flight once the response
  // goes out, silently dropping the email/WhatsApp.
  // Dispatch events (Partial Dispatch / Dispatched) don't email instantly —
  // a single truck run often carries several orders for the same party, so
  // each event queues into pending_dispatch_notifications instead, and
  // Dispatch/Admin sends one consolidated email (party + internal team) per
  // party from /admin/dispatch-notifications once a batch is complete.
  // WhatsApp is unaffected and still fires per job, same as every other
  // trigger stage.
  const isDispatchEvent = new_status === 'Partial Dispatch' || new_status === 'Dispatched';

  // A revert is a correction, not an event the party should hear about —
  // "Shade Card Sent" is a trigger stage, and reverting to it would email and
  // WhatsApp the customer a second time about something that already happened.
  if (NOTIFICATION_TRIGGER_STAGES.includes(new_status) && !movingBackward) {
    const notifyPayload = {
      job_id:     id,
      job_name:   job.job_name,
      po_number:  job.po_number,
      party:      job.party,
      status:     new_status,
      remark:     remark?.trim() ?? null,
      qty:        qty_dispatched ?? updatedJob.dispatched_qty,
    };

    // Internal-only calls — middleware rejects these without the header below.
    const internalHeaders = {
      'Content-Type':      'application/json',
      'x-internal-secret': process.env.CRON_SECRET ?? '',
    };

    const sends: Promise<Response>[] = [];
    if (!isDispatchEvent) {
      sends.push(fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notifications/email`, {
        method:  'POST',
        headers: internalHeaders,
        body:    JSON.stringify(notifyPayload),
      }));
    }
    sends.push(fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notifications/whatsapp`, {
      method:  'POST',
      headers: internalHeaders,
      body:    JSON.stringify(notifyPayload),
    }));

    // Failures are logged server-side but don't block the response.
    waitUntil(Promise.all(sends).catch((err) => {
      console.error('[POST status] notification error (non-fatal):', err);
    }));
  }

  if (isDispatchEvent) {
    sideEffects.push(admin
      .from('pending_dispatch_notifications')
      .insert({
        job_id:    id,
        job_name:  job.job_name,
        po_number: job.po_number,
        party:     job.party,
        status:    new_status,
        qty:       qty_dispatched ?? updatedJob.dispatched_qty,
        remark:    remark?.trim() ?? null,
        pm_code:   job.pm_code,
      })
      .then(logIfError('queue dispatch notification')));
  }

  await Promise.all(sideEffects);

  return NextResponse.json({ job: updatedJob });
}
