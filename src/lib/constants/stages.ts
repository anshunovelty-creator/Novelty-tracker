// src/lib/constants/stages.ts
// ============================================================
// SINGLE SOURCE OF TRUTH for the 15-stage pipeline.
// Every component, API route, and modal reads from here.
// Never hardcode stage names anywhere else in the codebase.
// ============================================================

export const STAGES = [
  'PO Received',
  'Artwork Received',
  'Prepress / Design Check',
  'Sample Printing',
  'Shade Card Sent',
  'Shade Card Approved',
  'In Printing',
  'Slitting',
  'Quality Check',
  'Packing',
  'Ready to Dispatch',
  'Partial Dispatch',
  'Dispatched',
  'On Hold',
  'PO Closed',
] as const;

export type Stage = typeof STAGES[number];

// Stages that appear in the sequential pipeline (excludes On Hold and PO Closed
// which are special — On Hold has no prerequisite; PO Closed is admin-only terminal).
export const PIPELINE_STAGES: Stage[] = [
  'PO Received',
  'Artwork Received',
  'Prepress / Design Check',
  'Sample Printing',
  'Shade Card Sent',
  'Shade Card Approved',
  'In Printing',
  'Slitting',
  'Quality Check',
  'Packing',
  'Ready to Dispatch',
  'Partial Dispatch',
  'Dispatched',
];

// Stages skipped for Repeat jobs — never shown in dropdown, shown as N/A in history
export const REPEAT_SKIPPED_STAGES: Stage[] = [
  'Sample Printing',
  'Shade Card Sent',
  'Shade Card Approved',
];

// Map each stage to its prerequisite stage (what must be completed first).
// Null = no prerequisite (PO Received is the first; On Hold has no prereq).
// For Repeat jobs, the prerequisite of 'In Printing' is overridden to
// 'Prepress / Design Check' — see getPrerequisite() below.
export const STAGE_PREREQUISITES: Record<Stage, Stage | null> = {
  'PO Received':             null,
  'Artwork Received':        'PO Received',
  'Prepress / Design Check': 'Artwork Received',
  'Sample Printing':         'Prepress / Design Check',
  'Shade Card Sent':         'Sample Printing',
  'Shade Card Approved':     'Shade Card Sent',
  'In Printing':             'Shade Card Approved',   // overridden for Repeat
  'Slitting':                'In Printing',
  'Quality Check':           'Slitting',
  'Packing':                 'Quality Check',
  'Ready to Dispatch':       'Packing',
  'Partial Dispatch':        'Ready to Dispatch',
  'Dispatched':              'Ready to Dispatch',     // either Partial or Ready
  'On Hold':                 null,                   // always available
  'PO Closed':               'Dispatched',
};

/**
 * Returns the prerequisite stage for a given target stage,
 * accounting for job type (Repeat jobs skip 3 stages).
 */
export function getPrerequisite(
  targetStage: Stage,
  jobType: 'New' | 'Repeat' | 'Artwork Changed'
): Stage | null {
  if (jobType === 'Repeat' && targetStage === 'In Printing') {
    return 'Prepress / Design Check';
  }
  return STAGE_PREREQUISITES[targetStage];
}

/**
 * Returns the visible pipeline stages for a given job type.
 * Repeat jobs have 3 stages removed from the pipeline.
 */
export function getVisibleStages(
  jobType: 'New' | 'Repeat' | 'Artwork Changed'
): Stage[] {
  if (jobType === 'Repeat') {
    return PIPELINE_STAGES.filter(
      (s) => !REPEAT_SKIPPED_STAGES.includes(s)
    );
  }
  return PIPELINE_STAGES;
}

/**
 * Returns true if a stage is skipped for this job type.
 * Used to render N/A in history and grey out in dropdown.
 */
export function isStageSkipped(
  stage: Stage,
  jobType: 'New' | 'Repeat' | 'Artwork Changed'
): boolean {
  if (jobType !== 'Repeat') return false;
  return REPEAT_SKIPPED_STAGES.includes(stage);
}

/**
 * Progress percentage for the progress bar.
 * Counts completed stages out of visible stages (not all 15).
 * Excludes On Hold and PO Closed from the count.
 */
export function getProgressPercent(
  completedStages: Stage[],
  jobType: 'New' | 'Repeat' | 'Artwork Changed'
): number {
  const visible = getVisibleStages(jobType);
  const completedVisible = completedStages.filter((s) =>
    visible.includes(s)
  );
  if (visible.length === 0) return 0;
  return Math.round((completedVisible.length / visible.length) * 100);
}

/**
 * Stage index in the full PIPELINE_STAGES array.
 * Used for forward/backward movement validation.
 * Returns -1 for On Hold and PO Closed (special stages).
 */
export function stageIndex(stage: Stage): number {
  return PIPELINE_STAGES.indexOf(stage);
}

// Stages that trigger notifications (email + WhatsApp)
export const NOTIFICATION_TRIGGER_STAGES: Stage[] = [
  'Shade Card Sent',
  'Ready to Dispatch',
  'Dispatched',
  'On Hold',
];

// Dispatch-related stages (affect qty tracking)
export const DISPATCH_STAGES: Stage[] = [
  'Partial Dispatch',
  'Dispatched',
];

// Stages that require a modal before saving
export type ModalRequiredStage =
  | 'On Hold'
  | 'Quality Check'
  | 'Partial Dispatch'
  | 'Dispatched'
  | 'PO Closed';

export const MODAL_REQUIRED_STAGES: Stage[] = [
  'On Hold',
  'Quality Check',
  'Partial Dispatch',
  'Dispatched',
  'PO Closed',
];
