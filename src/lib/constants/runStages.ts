// src/lib/constants/runStages.ts
// ============================================================
// SINGLE SOURCE OF TRUTH for the per-run pipeline.
// A print run (one production cycle / scheduled release) repeats every
// non-prepress job stage:
//   Printing → Slitting → QC → Packing → Ready to Dispatch → Dispatched
// The one-time steps (PO Received … Shade Card Approved) stay on the
// job-level pipeline in constants/stages.ts and are never repeated per run.
// Every component and API route reads from here — never hardcode run
// stage names anywhere else.
// ============================================================

import type { Department } from './departments';

export const RUN_STAGES = [
  'Printing',
  'Slitting',
  'QC',
  'Packing',
  'Ready to Dispatch',
  'Dispatched',
] as const;

export type RunStage = typeof RUN_STAGES[number];

// Display labels for the client portal and admin panel.
export const RUN_STAGE_LABELS: Record<RunStage, string> = {
  'Printing':          'Printing',
  'Slitting':          'Slitting',
  'QC':                'Quality Check',
  'Packing':           'Packing',
  'Ready to Dispatch': 'Ready to Dispatch',
  'Dispatched':        'Dispatched',
};

// Which departments may set each run stage (Admin always allowed).
// Mirrors DEPT_ALLOWED_STAGES for the equivalent job stages.
export const RUN_STAGE_DEPTS: Record<RunStage, Department[]> = {
  'Printing':          ['Production'],
  'Slitting':          ['Production'],
  'QC':                ['QC'],
  'Packing':           ['Dispatch'],
  'Ready to Dispatch': ['Dispatch'],
  'Dispatched':        ['Dispatch'],
};

/** The stage after `stage`, or null if the run is complete. */
export function nextRunStage(stage: RunStage): RunStage | null {
  const idx = RUN_STAGES.indexOf(stage);
  if (idx === -1 || idx === RUN_STAGES.length - 1) return null;
  return RUN_STAGES[idx + 1];
}

/** True if `dept` may advance a run to `stage`. */
export function canDeptSetRunStage(dept: Department, stage: RunStage): boolean {
  return dept === 'Admin' || RUN_STAGE_DEPTS[stage].includes(dept);
}
