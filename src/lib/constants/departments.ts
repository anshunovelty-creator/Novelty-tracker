// src/lib/constants/departments.ts
// ============================================================
// Department → allowed stages mapping.
// This is the access control truth table from the spec.
// Also contains display name logic for client portal.
// ============================================================

import type { Stage } from './stages';

export const DEPARTMENTS = [
  'Prepress',
  'QC',
  'Production',
  'Postpress',
  'Dispatch',
  'Admin',
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
 * Who may add, correct, or remove a die/plate reference entry.
 * Prepress makes and owns dies and plates, so they enter and correct their
 * own records; Admin always has full access. Everyone else searches and views.
 */
export const DIES_PLATES_EDIT_DEPTS: Department[] = ['Prepress', 'Admin'];

export function canDeptManageDiesPlates(dept: Department | null): boolean {
  return dept !== null && DIES_PLATES_EDIT_DEPTS.includes(dept);
}

export function canDeptSetStage(dept: Department, stage: Stage): boolean {
  const allowed = DEPT_ALLOWED_STAGES[dept];
  if (allowed === '*') return true;
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
