// src/lib/constants/departments.ts
// ============================================================
// Department → permission mapping.
// Departments and their permissions are DB-configurable (departments,
// department_feature_permissions, department_stage_permissions,
// department_run_stage_permissions tables — see migrations 039/040) and
// managed from /admin/departments. This file loads that data (cached,
// see loadDeptCache below) and exposes the same canDeptXxx(...) helper
// names every call site already used — they now take a loaded
// DeptPermissions object instead of a bare department string.
// ============================================================

import { createAdminClient } from '@/lib/supabase/admin';
import type { Stage } from './stages';
import type { RunStage } from './runStages';
import type { PrintingMethod } from '../types';

export type Department = string;

export type DeptPermissions = {
  key: string;
  displayName: string;
  clientFacingName: string;
  isSuperAdmin: boolean;
  isReadOnly: boolean;
  allStages: boolean;
  printingMethodScope: PrintingMethod | null;
  features: string[];
  stages: Stage[];
  runStages: RunStage[];
};

// ── Cache ─────────────────────────────────────────────────────
// Small dataset (a handful of departments, a few dozen permission rows
// total) — loaded via the service-role client (bypasses RLS, so this
// doesn't depend on any particular caller's session) and cached
// process-wide for CACHE_TTL_MS. The admin UI (Phase 4) calls
// invalidateDeptCache() after every write so changes take effect
// immediately instead of waiting out the TTL.
const CACHE_TTL_MS = 60_000;
let cache: { byKey: Map<string, DeptPermissions>; expiresAt: number } | null = null;

export function invalidateDeptCache(): void {
  cache = null;
}

async function loadDeptCache(): Promise<Map<string, DeptPermissions>> {
  if (cache && cache.expiresAt > Date.now()) return cache.byKey;

  const admin = createAdminClient();
  const [depts, features, stages, runStages] = await Promise.all([
    admin.from('departments').select('*'),
    admin.from('department_feature_permissions').select('department_id, feature_key'),
    admin.from('department_stage_permissions').select('department_id, stage'),
    admin.from('department_run_stage_permissions').select('department_id, run_stage'),
  ]);

  const byId = new Map<string, DeptPermissions>();
  const byKey = new Map<string, DeptPermissions>();

  for (const d of depts.data ?? []) {
    const perms: DeptPermissions = {
      key: d.key,
      displayName: d.display_name,
      clientFacingName: d.client_facing_name ?? d.display_name,
      isSuperAdmin: d.is_super_admin,
      isReadOnly: d.is_read_only,
      allStages: d.all_stages,
      printingMethodScope: d.printing_method_scope,
      features: [],
      stages: [],
      runStages: [],
    };
    byId.set(d.id, perms);
    byKey.set(d.key, perms);
  }
  for (const f of features.data ?? []) byId.get(f.department_id)?.features.push(f.feature_key);
  for (const s of stages.data ?? []) byId.get(s.department_id)?.stages.push(s.stage as Stage);
  for (const r of runStages.data ?? []) byId.get(r.department_id)?.runStages.push(r.run_stage as RunStage);

  cache = { byKey, expiresAt: Date.now() + CACHE_TTL_MS };
  return byKey;
}

/**
 * Resolves the raw department string from JWT/user_metadata into its
 * full loaded permission set. Returns null for anything that isn't a
 * non-empty string, or doesn't match a department that currently exists
 * in the `departments` table — the same "reject bad tokens" contract
 * `parseDepartment` used to have, now backed by a DB lookup instead of
 * a hardcoded array. Every server-side call site that used to do
 * `parseDepartment(...)` now does `await getDeptPermissions(...)`.
 */
export async function getDeptPermissions(rawDept: unknown): Promise<DeptPermissions | null> {
  if (typeof rawDept !== 'string' || !rawDept) return null;
  const byKey = await loadDeptCache();
  return byKey.get(rawDept) ?? null;
}

function hasFeature(perms: DeptPermissions | null, featureKey: string): boolean {
  return perms !== null && (perms.isSuperAdmin || perms.features.includes(featureKey));
}

/** Who may set a job's printing method / unit. */
export function canDeptSetPrinting(perms: DeptPermissions | null): boolean {
  return hasFeature(perms, 'printing_edit');
}

/** Who may correct a job's detail fields (PO#, party, PM code, name, qty, type, PO date, notes). */
export function canDeptEditJobDetails(perms: DeptPermissions | null): boolean {
  return hasFeature(perms, 'job_detail_edit');
}

/** Who may change the label stock shelf. */
export function canDeptManageStock(perms: DeptPermissions | null): boolean {
  return hasFeature(perms, 'stock_edit');
}

/** Who may view/send the queued, party-consolidated dispatch email. */
export function canDeptManageDispatchNotifications(perms: DeptPermissions | null): boolean {
  return hasFeature(perms, 'dispatch_notifications');
}

/** Who may add/correct/remove a party's dispatch-email contact. */
export function canDeptManagePartyContacts(perms: DeptPermissions | null): boolean {
  return hasFeature(perms, 'party_contacts_manage');
}

/** Who may add/correct/remove a die/plate reference entry. */
export function canDeptManageDiesPlates(perms: DeptPermissions | null): boolean {
  return hasFeature(perms, 'dies_plates_edit');
}

/** Who may add/correct/remove a Job Separation row. */
export function canDeptManageJobSeparation(perms: DeptPermissions | null): boolean {
  return hasFeature(perms, 'job_separation_edit');
}

/** Who may add/complete/log entries on the Prepress-Todo checklist. */
export function canDeptManagePrepressTodo(perms: DeptPermissions | null): boolean {
  return hasFeature(perms, 'prepress_todo_manage');
}

/** Who may open Register (the customer follow-up CRM) at all — read and write. */
export function canDeptManageRegister(perms: DeptPermissions | null): boolean {
  return hasFeature(perms, 'register_manage');
}

/** Who may open the Bill of Material section at all — read and write. */
export function canDeptUseBOM(perms: DeptPermissions | null): boolean {
  return hasFeature(perms, 'bom_use');
}

/** Who may answer a BOM line — order it, cut it short, swap in an alternative, or refuse it. */
export function canDeptDecideBOM(perms: DeptPermissions | null): boolean {
  return hasFeature(perms, 'bom_decide');
}

/** Who may manage the internal dispatch-notification recipient list ("Dispatch Alerts"). */
export function canDeptManageNotificationRecipients(perms: DeptPermissions | null): boolean {
  return hasFeature(perms, 'notification_recipients_manage');
}

/** Who may add/remove team logins (and who counts toward the "last super-admin" safety check). */
export function canDeptManageTeam(perms: DeptPermissions | null): boolean {
  return hasFeature(perms, 'team_manage');
}

/** Who may run the data export. */
export function canDeptExportData(perms: DeptPermissions | null): boolean {
  return hasFeature(perms, 'export_data');
}

/** Who may edit a job's delivery date. */
export function canDeptEditDeliveryDate(perms: DeptPermissions | null): boolean {
  return hasFeature(perms, 'delivery_date_edit');
}

/** Who may confirm a job's slitting completion. */
export function canDeptConfirmSlitting(perms: DeptPermissions | null): boolean {
  return hasFeature(perms, 'slitting_confirm');
}

/** Who may manage print runs (create/edit/schedule a run). */
export function canDeptManagePrintRuns(perms: DeptPermissions | null): boolean {
  return hasFeature(perms, 'print_run_manage');
}

/** Who may manage the machine board (machines + their queues). */
export function canDeptManageMachineBoard(perms: DeptPermissions | null): boolean {
  return hasFeature(perms, 'machine_board_manage');
}

/** Who may override a job to PO Closed ahead of its normal prerequisite. */
export function canDeptOverridePOClosed(perms: DeptPermissions | null): boolean {
  return hasFeature(perms, 'po_closed_override');
}

/**
 * Whether `perms` may set a job to `stage`. `printingMethodScope` generalizes
 * the old Unit1Admin-only "full access but Offset jobs only" rule to any
 * department: when set, it restricts stage-setting to jobs whose
 * printing_method matches, regardless of whether access comes from
 * `allStages` or an explicit stage grant. Pass the job's printing_method
 * wherever it's known so the UI can grey out stages the department can't
 * touch on that job; the actual enforcement point is always the server-side
 * check in POST /api/jobs/[id]/status, which re-checks after fetching the job.
 */
export function canDeptSetStage(
  perms: DeptPermissions,
  stage: Stage,
  printingMethod?: PrintingMethod
): boolean {
  if (perms.printingMethodScope && printingMethod && printingMethod !== perms.printingMethodScope) {
    return false;
  }
  if (perms.allStages) return true;
  return perms.stages.includes(stage);
}

/** Whether `perms` may advance a print run to `runStage` (see constants/runStages.ts). */
export function canDeptSetRunStage(perms: DeptPermissions | null, runStage: RunStage): boolean {
  return perms !== null && (perms.isSuperAdmin || perms.runStages.includes(runStage));
}
