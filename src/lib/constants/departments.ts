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
  'Dispatch',
  'Admin',
] as const;

export type Department = typeof DEPARTMENTS[number];

// Which stages each department can SET (update status to).
// Admin can set all stages — represented as '*'.
export const DEPT_ALLOWED_STAGES: Record<Department, Stage[] | '*'> = {
  Prepress: [
    'PO Received',
    'Artwork Received',
    'Prepress / Design Check',
  ],
  QC: [
    'Sample Printing',
    'Shade Card Sent',
    'Shade Card Approved',
    'Quality Check',
  ],
  Production: [
    'In Printing',
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
