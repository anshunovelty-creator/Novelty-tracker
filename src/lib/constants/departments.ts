// src/lib/constants/departments.ts
// ============================================================
// Department → allowed stages mapping.
// This is the access control truth table from the spec.
// Also contains display name logic for client portal.
// ============================================================

import type { Stage } from './stages';
import type { PrintingMethod } from '../types';

export const DEPARTMENTS = [
  'Prepress',
  'QC',
  'Production',
  'Postpress',
  'Dispatch',
  'Admin',
  // Unit-1 (Offset) floor admin. Full stage access like Admin — see
  // DEPT_ALLOWED_STAGES — but canDeptSetStage additionally checks the job's
  // printing_method for this department and rejects non-Offset jobs, since
  // this is the only department whose stage access is unit-scoped rather
  // than stage-scoped. Deliberately excluded from every other *_EDIT_DEPTS
  // allow-list below (Dies/Plates/Job Separation stay view-only for it;
  // that same exclusion blocks the Prepress-Todo checklist, which reuses
  // canDeptManageJobSeparation), and from BOM/Register. Every literal
  // `dept === 'Admin'` check elsewhere in the app (Team, Follow-ups,
  // export, PO Closed, prerequisite-skip override) excludes it too, since
  // it isn't the string 'Admin'.
  'Unit1Admin',
  // Read-only: sees every page and every job, same as Admin, but is never
  // added to a *_EDIT_DEPTS allow-list below and DEPT_ALLOWED_STAGES gives
  // it no stages — so every write path that already gates on department
  // rejects it by construction. Middleware also blocks it from mutating
  // methods on /api/* as a second, centralized backstop for the handful of
  // routes that don't (yet) check department themselves.
  'Viewer',
] as const;

export type Department = typeof DEPARTMENTS[number];

// Which stages each department can SET (update status to).
// Admin can set all stages — represented as '*'.
export const DEPT_ALLOWED_STAGES: Record<Department, Stage[] | '*'> = {
  Prepress: [
    'PO Received',
    'Artwork Pending',
    'Plate Status',
    'Job Card Done',
  ],
  QC: [
    'Sample Printing',
    'Shade Card Sent',
    'Shade Card Approved',
    'Quality Check',
  ],
  // Production runs the presses and nothing downstream of them.
  Production: [
    'In Printing',
    'On Hold',
  ],
  // Postpress took slitting off Production. On Hold comes with it: a team
  // that owns a physical machine has to be able to say it stopped.
  Postpress: [
    'Slitting',
    'On Hold',
  ],
  Dispatch: [
    'Packing',
    'Ready to Dispatch',
    'Partial Dispatch',
    'Dispatched',
  ],
  Admin: '*',
  // '*' here too — canDeptSetStage narrows it to Offset jobs only, since
  // DEPT_ALLOWED_STAGES has no notion of "which job" to scope by itself.
  Unit1Admin: '*',
  Viewer: [],
};

/**
 * Returns true if the department is allowed to set the given stage.
 */
/**
 * Who may set a job's printing method / unit.
 * Prepress and Production make the call on the floor; Admin always has
 * full access. QC and Dispatch can see the assignment but not change it.
 */
export const PRINTING_EDIT_DEPTS: Department[] = ['Prepress', 'Production', 'Admin'];

export function canDeptSetPrinting(dept: Department | null): boolean {
  return dept !== null && PRINTING_EDIT_DEPTS.includes(dept);
}

/**
 * Who may correct a job's detail fields — PO number, party, PM code, job
 * name, quantity, type, PO date, notes — through the Edit Job form.
 *
 * Prepress enters most jobs off the PO, so they fix their own typos. Admin
 * always has full access. QC and Dispatch read these fields but do not own
 * them; Dispatch still owns the delivery date, which is guarded separately.
 */
export const JOB_DETAIL_EDIT_DEPTS: Department[] = ['Prepress', 'Admin'];

export function canDeptEditJobDetails(dept: Department | null): boolean {
  return dept !== null && JOB_DETAIL_EDIT_DEPTS.includes(dept);
}

/**
 * Who may change the label stock shelf — add a manual entry, correct a
 * quantity, or mark stock as dispatched out.
 *
 * Dispatch physically handles the shelf, so they own it; Admin always may.
 * Everyone else can read stock (the page is open to all staff) but not move it.
 */
export const STOCK_EDIT_DEPTS: Department[] = ['Dispatch', 'Admin'];

export function canDeptManageStock(dept: Department | null): boolean {
  return dept !== null && STOCK_EDIT_DEPTS.includes(dept);
}

/**
 * Who may view and send the queued, party-consolidated dispatch email.
 * Dispatch owns marking jobs Dispatched/Partial Dispatch, so they own
 * sending the resulting notification too; Admin always has full access.
 */
export const DISPATCH_NOTIFICATION_DEPTS: Department[] = ['Dispatch', 'Admin'];

export function canDeptManageDispatchNotifications(dept: Department | null): boolean {
  return dept !== null && DISPATCH_NOTIFICATION_DEPTS.includes(dept);
}

/**
 * Who may add, correct, or remove a die/plate reference entry.
 * Prepress makes and owns dies and plates, so they enter and correct their
 * own records; Admin always has full access. Everyone else searches and views.
 */
export const DIES_PLATES_EDIT_DEPTS: Department[] = ['Prepress', 'Admin'];

export function canDeptManageDiesPlates(dept: Department | null): boolean {
  return dept !== null && DIES_PLATES_EDIT_DEPTS.includes(dept);
}

/**
 * Who may add, correct, or remove a Job Separation row.
 * Prepress splits the PO into job entries, so they enter and correct their
 * own records; Admin always has full access. Everyone else searches and
 * watches it live.
 */
export const JOB_SEPARATION_EDIT_DEPTS: Department[] = ['Prepress', 'Admin'];

export function canDeptManageJobSeparation(dept: Department | null): boolean {
  return dept !== null && JOB_SEPARATION_EDIT_DEPTS.includes(dept);
}

/**
 * Who may open Register at all — the customer follow-up CRM.
 * Admin only, both to read and to write: unlike every other feature here,
 * this data (customer contacts, deal values, sales notes) has no reason to
 * be shop-floor-visible, so the gate covers GET as well as writes. Backed
 * by RLS too (register_*_select_admin policies), not just this check.
 */
export const REGISTER_EDIT_DEPTS: Department[] = ['Admin'];

export function canDeptManageRegister(dept: Department | null): boolean {
  return dept !== null && REGISTER_EDIT_DEPTS.includes(dept);
}

/**
 * Who may open the Bill of Material section at all — the material
 * requisitions Production used to raise by mailing the owner.
 *
 * Production and Admin only, and like Register the gate covers reads as
 * well as writes: no other department has a reason to see what stock is
 * being asked for or what the owner approved. Backed by RLS too
 * (bom_*_select_prod_admin policies), not just this check. Viewer is
 * deliberately excluded here even though it reads every other table.
 */
export const BOM_DEPTS: Department[] = ['Production', 'Admin'];

export function canDeptUseBOM(dept: Department | null): boolean {
  return dept !== null && BOM_DEPTS.includes(dept);
}

/**
 * Who may answer a BOM line — order it, cut it short, swap in an
 * alternative, or refuse it. Admin alone: the whole point of the feature is
 * that the owner is the one who decides what gets bought. Production raises
 * and tracks, and may withdraw its own request, but never decides.
 */
export const BOM_DECIDE_DEPTS: Department[] = ['Admin'];

export function canDeptDecideBOM(dept: Department | null): boolean {
  return dept !== null && BOM_DECIDE_DEPTS.includes(dept);
}

/**
 * Whether `dept` may set a job to `stage`. Unit1Admin is the one department
 * whose '*' is conditional: it only covers jobs actually running on Unit 1
 * (printing_method === 'Offset'), since Unit 1 and Unit 2 run completely
 * separate floors. Pass the job's printing_method wherever it's known
 * (job detail / job row / job card) so the dropdown greys out stages for
 * jobs Unit1Admin can't touch instead of only failing server-side; the
 * POST /api/jobs/[id]/status route re-checks this after fetching the job
 * regardless, since that's the actual enforcement point.
 */
export function canDeptSetStage(
  dept: Department,
  stage: Stage,
  printingMethod?: PrintingMethod
): boolean {
  const allowed = DEPT_ALLOWED_STAGES[dept];
  if (allowed === '*') {
    if (dept === 'Unit1Admin' && printingMethod && printingMethod !== 'Offset') return false;
    return true;
  }
  return allowed.includes(stage);
}

// Display name shown on admin panel for each department
export const DEPT_DISPLAY_NAME: Record<Department, string> = {
  Prepress:   'Prepress Team',
  QC:         'QC Team',
  Production: 'Production Team',
  Postpress:  'Postpress Team',
  Dispatch:   'Dispatch Team',
  Admin:      'Admin',
  Unit1Admin: 'Unit 1 Admin',
  Viewer:     'Viewer (read-only)',
};

/**
 * Display name shown on the CLIENT PORTAL.
 * Admin actions must show as "Novelty Labels Team" — internal identity hidden.
 */
export function getClientFacingDeptName(dept: Department): string {
  if (dept === 'Admin') return 'Novelty Labels Team';
  return DEPT_DISPLAY_NAME[dept];
}

/**
 * Parses a department string from JWT metadata.
 * Returns null if not a valid department — use to reject bad tokens.
 */
export function parseDepartment(value: unknown): Department | null {
  if (typeof value !== 'string') return null;
  return DEPARTMENTS.includes(value as Department)
    ? (value as Department)
    : null;
}
