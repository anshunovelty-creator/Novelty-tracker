// src/lib/types.ts
// ============================================================
// TypeScript interfaces — one per database table + select views.
// These are the canonical types used across the entire codebase.
// Never use 'any'. Extend these as needed, never weaken them.
// ============================================================

import type { Stage } from './constants/stages';
import type { Department } from './constants/departments';
import type { RunStage } from './constants/runStages';

// ── team ─────────────────────────────────────────────────────
// A login account, not a database row — Supabase Auth is the source of
// truth (see /api/team). department is null only for a mis-configured
// account (see parseDepartment); the admin panel itself never creates one
// without a department.

export interface Member {
  id: string;
  email: string;
  department: Department | null;
  created_at: string;
  last_sign_in_at: string | null;
}

// ── jobs ─────────────────────────────────────────────────────

export type JobType = 'New' | 'Repeat' | 'Artwork Changed';

export interface Job {
  id: string;
  // Auto-assigned by the set_job_card_number DB trigger on insert.
  // Format '<mon><yy>-<seq>' e.g. 'jul26-102'; seq restarts each month.
  // Nullable only to tolerate rows written before migration 011.
  job_card_number: string | null;
  // Defaults to 'Flexo' at creation. Changing it snaps printing_unit_id
  // to that method's default unit unless a unit is set in the same write.
  printing_method: PrintingMethod;
  // Null only when no active unit exists for the method, or the assigned
  // unit was deleted (FK is ON DELETE SET NULL).
  printing_unit_id: string | null;
  // Present when fetched with the printing_units(...) join.
  printing_units?: Pick<PrintingUnit, 'id' | 'name' | 'printing_method'> | null;
  po_number: string;
  pm_code: string | null;
  party: string;
  job_name: string | null;
  label_qty: number | null;
  po_date: string | null;           // ISO date string 'YYYY-MM-DD'
  delivery_date: string | null;     // ISO date string
  status: Stage;
  job_type: JobType;
  urgent: boolean;
  urgent_priority: number | null;   // 1–5
  notes: string | null;
  dispatched_qty: number;
  remaining_qty: number | null;
  halt_remark: string | null;
  qc_remark: string | null;
  // Set when Postpress (or Admin) confirms slitting is physically done —
  // gates the Quality Check prerequisite. See migration 018.
  slitting_confirmed_at: string | null;
  is_scheduled_release: boolean;
  is_closed: boolean;
  total_qty_dispatched: number;     // cumulative qty dispatched via print runs
  has_partial_runs: boolean;        // true once a run is created with qty remaining
  created_at: string;               // ISO timestamp
  updated_at: string;
  // Present when fetched with the job_stage_timestamps(stage) join —
  // used to render ✓ marks for completed stages in the status dropdown.
  job_stage_timestamps?: { stage: Stage }[];
  // Present when fetched with the print_runs join — multi-cycle orders.
  print_runs?: PrintRun[];
}

// ── label_stock ──────────────────────────────────────────────

/**
 * Why a row of printed labels is on the shelf.
 * 'Remaining' — balance of a partially dispatched order; cleared on full dispatch.
 * 'Extra'     — surplus beyond the order; survives full dispatch.
 * 'Manual'    — found stock the system never knew about.
 */
export type StockKind = 'Remaining' | 'Extra' | 'Manual';

export const STOCK_KINDS: StockKind[] = ['Remaining', 'Extra', 'Manual'];

export interface LabelStock {
  id: string;
  // Null once the originating job is deleted — the physical stock outlives it.
  job_id: string | null;
  kind: StockKind;
  qty: number;
  // Snapshot of the job as it was when the stock was recorded.
  job_card_number: string | null;
  po_number:       string | null;
  pm_code:         string | null;
  party:           string;
  job_name:        string | null;
  location: string | null;
  remark:   string | null;
  is_dispatched: boolean;
  dispatched_at: string | null;
  dispatched_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ── dies ─────────────────────────────────────────────────────
// Cutting dies used to punch label shapes. Entered by Prepress off the die
// maker's spec sheet; every department can search and view them, only
// Prepress and Admin can add, correct or remove an entry. Field order
// mirrors the source spec sheet (JOB, LENGTH, WIDTH, CYLINDER, MATERIAL,
// Ups, Gap, CORNER, SERIAL No., Die Rec. on), followed by the operational
// fields added afterward (Location, Status).

/**
 * 'IN USE' — on the rack, nothing wrong with it (default).
 * 'EXTRA'  — a spare beyond what's mounted.
 * 'DAMAGE' — out of rotation; damage_date and damage_reason apply only
 *            to this status, enforced together server-side.
 */
export type DieStatus = 'IN USE' | 'EXTRA' | 'DAMAGE';

export const DIE_STATUSES: DieStatus[] = ['IN USE', 'EXTRA', 'DAMAGE'];

export interface Die {
  id: string;
  job_name: string;               // JOB — the product/label this die was cut for
  length: string | null;          // LENGTH
  width: string | null;           // WIDTH — often a combined "H x W" reading
  cylinder: number | null;        // CYLINDER
  material: string | null;        // MATERIAL
  ups: number | null;             // Ups — labels per revolution
  gap: string | null;             // Gap — e.g. "5 MM"
  corner: string | null;          // CORNER — e.g. "SPECIAL", "ROUND"
  serial_no: string | null;       // SERIAL No. — identifier etched on the die
  die_received_on: string | null; // Die Rec. on — ISO date string
  location: string | null;        // rack / shelf / bay
  status: DieStatus;
  damage_date: string | null;     // set only when status is 'DAMAGE'
  damage_reason: string | null;   // set only when status is 'DAMAGE'
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ── flatbed dies ─────────────────────────────────────────────
// The shop's second physical die type, alongside the rotary dies above.
// No cylinder (a flatbed die doesn't rotate) and no job/material identity
// — flatbed dies are logged by their geometry alone. No status/damage
// tracking either (the team decided against it) — serial_no is a plain
// 1, 2, 3, ... assigned by the database on insert, not typed in by hand.

export interface FlatbedDie {
  id: string;
  serial_no: number;              // auto-incrementing, DB-assigned
  length: string | null;          // LENGTH
  width: string | null;           // WIDTH — often a combined "H x W" reading
  ups: number | null;             // Ups — labels per sheet/stroke
  gap: string | null;             // Gap — e.g. "5 MM"
  corner: string | null;          // Corner radius — e.g. "3 MM", "SPECIAL"
  shape: string | null;           // e.g. "RECTANGLE", "OVAL"
  location: string | null;        // rack / shelf / bay
  die_received_on: string | null; // ISO date string
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ── plates ───────────────────────────────────────────────────
// Printing plates mounted on press cylinders. Same access model as dies:
// Prepress and Admin own entry, everyone else searches and views. Field
// order mirrors the source spec sheet (PARTY, PM CODE, ITEM NAME, ACROSS
// SIZE (H), AROUND SIZE (W), CYLINDER, PLATE ID, PLATE DATE, LABEL PER
// ROUND, LOCATION).

export interface Plate {
  id: string;
  party: string;                  // PARTY
  pm_code: string | null;         // PM CODE
  item_name: string | null;       // ITEM NAME
  across_size: string | null;     // ACROSS SIZE (H)
  around_size: string | null;     // AROUND SIZE (W)
  cylinder: number | null;        // CYLINDER
  plate_id: string | null;        // PLATE ID — identifier etched on the plate
  plate_date: string | null;      // PLATE DATE — ISO date string
  label_per_round: number | null; // LABEL PER ROUND
  location: string | null;        // LOCATION — rack / shelf / bay
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ── job separations ─────────────────────────────────────────
// The Prepress worksheet that splits an incoming PO into individually
// trackable line items ahead of job-card creation. Every department can
// search and watch it live; only Prepress and Admin add, correct or
// remove a row. Field order mirrors the source sheet (Sr. No., Party, Po
// No, Po Date, PM Code, Material Name, Quantity, Unit, Job Status, Rate,
// Order Value, JC Status, AW send to).

export interface JobSeparation {
  id: string;
  sr_no: string | null;           // auto-assigned, e.g. AUG26-1
  party: string;                  // Party
  po_no: string | null;           // Po No
  po_date: string | null;         // Po Date — ISO date string
  pm_code: string | null;         // PM Code
  material_name: string | null;   // Material Name
  quantity: number | null;        // Quantity
  unit: string | null;            // Unit — '1' | '2' | '1&2'
  job_status: string | null;      // Job Status
  rate: number | null;            // Rate
  order_value: number | null;     // Order Value — server-derived, quantity × rate
  jc_status: string | null;       // JC Status
  aw_send_to: string | null;      // AW send to
  // Set once "Add Job" has been used on this row — see
  // src/app/api/job-separations/[id]/create-job/route.ts. Denormalized
  // job_card_number alongside the id so the worksheet can display it
  // without a join.
  linked_job_id: string | null;
  linked_job_card_number: string | null;
  // Set once Cancel Job is used — see
  // src/app/api/job-separations/[id]/cancel/route.ts. One-way: there is no
  // un-cancel action, so the row stays visible (struck through) forever
  // instead of being hard-deleted and leaving its Sr. No. unexplained.
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Master list of party names — feeds the Job Separation Party typeahead
// so entries stay spelled consistently. job_separations.party itself
// stays free TEXT; this is a lookup list, not a foreign key.
export interface Party {
  id: string;
  name: string;
  created_by: string | null;
  created_at: string;
}

// Shared Prepress reminder checklist, surfaced as an always-visible panel
// on the Job Separation worksheet. Marking a task read flags it (shown
// green) so the team can verify it before someone deletes it for good —
// deleting is the only way a row actually disappears.
export interface PrepressTodo {
  id: string;
  task: string;
  created_by: string | null;
  created_at: string;
  marked_read_at: string | null;
}

/** Audit trail row for prepress_todos — see 028_prepress_todo_logs.sql. */
export interface PrepressTodoLog {
  id: string;
  todo_id: string | null;
  task: string;
  action: 'created' | 'completed' | 'reopened' | 'edited' | 'deleted';
  actor_department: string | null;
  actor_email: string | null;
  created_at: string;
}

// Register — Admin-only customer follow-up CRM (accounts, deals moving
// through a 5-stage pipeline, and a follow-up activity log). Migrated
// from a prototype artifact; see 027_register_crm.sql for the schema
// this mirrors.
export type RegisterStage = 'enquiry' | 'artwork' | 'quotation' | 'approval' | 'po';
export type RegisterDealStatus = 'open' | 'won' | 'lost';

export interface RegisterAccount {
  id: string;
  name: string;
  contact_name: string | null;
  contact_role: string | null;
  phone: string | null;
  email: string | null;
  segment: string | null;
  city: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RegisterDeal {
  id: string;
  account_id: string;
  title: string;
  stage: RegisterStage;
  owner: string | null;
  qty: string | null;
  value: number | null;
  substrate: string | null;
  next_action: string | null;
  next_action_date: string | null;
  status: RegisterDealStatus;
  lost_reason: string | null;
  closed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RegisterActivity {
  id: string;
  account_id: string;
  deal_id: string | null;
  date: string;
  type: string;
  by: string | null;
  note: string | null;
  created_at: string;
}

// Form data for Add Job — subset of Job used in the form
/** Printing process a unit runs. Mirrors the jobs_printing_method_check constraint. */
export type PrintingMethod = 'Offset' | 'Flexo';

export const PRINTING_METHODS: PrintingMethod[] = ['Offset', 'Flexo'];

/** Admin-managed printing unit, e.g. { name: 'Unit-1', printing_method: 'Offset' }. */
export interface PrintingUnit {
  id: string;
  name: string;
  printing_method: PrintingMethod;
  // Lowest sort_order among active units of a method is that method's default.
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AddJobFormData {
  po_number: string;
  pm_code: string;
  party: string;
  job_name: string;
  label_qty: number | null;
  job_type: JobType;
  po_date: string;
  delivery_date: string;
  status: Stage;
  urgent: boolean;
  urgent_priority: number | null;
  notes: string;
  is_scheduled_release: boolean;
  scheduled_releases?: ScheduledReleaseInput[];
  // Defaults to 'Flexo'. Leaving printing_unit_id null lets the
  // set_job_printing_unit trigger pick that method's default unit.
  printing_method: PrintingMethod;
  printing_unit_id: string | null;
}

export interface ScheduledReleaseInput {
  release_number: number;
  planned_qty: number;
  planned_date: string;
}

// ── job_stage_timestamps ──────────────────────────────────────

export interface JobStageTimestamp {
  id: string;
  job_id: string;
  stage: Stage;
  completed_at: string;
}

// ── job_status_logs ───────────────────────────────────────────

export interface JobStatusLog {
  id: string;
  job_id: string;
  status: Stage;
  changed_by_dept: Department;
  changed_at: string;
  remark: string | null;
  qty_dispatched: number | null;
}

// Client-safe view (Admin → "Novelty Labels Team")
export interface ClientStatusLog {
  id: string;
  job_id: string;
  status: Stage;
  department_display: string;       // already transformed by DB view
  changed_at: string;
  remark: string | null;
  qty_dispatched: number | null;
}

// ── stage_comments ────────────────────────────────────────────

export interface StageComment {
  id: string;
  job_id: string;
  stage: Stage;
  comment: string;
  created_by: string;
  /** NULL for notes written before migration 016 — fall back to created_by. */
  created_by_email: string | null;
  created_at: string;
}

/** A stage comment joined with its job, for the global notes feed. */
export interface NoteFeedItem extends StageComment {
  job_name: string | null;
  pm_code: string | null;
  po_number: string;
  party: string;
  /** Has the calling user marked this note read? See migration 017_note_reads. */
  read: boolean;
}

// ── dispatch_schedules ────────────────────────────────────────

export type ReleaseStatus = 'Pending' | 'In Progress' | 'Dispatched';

export interface DispatchSchedule {
  id: string;
  job_id: string;
  release_number: number;
  planned_qty: number;
  planned_date: string;
  actual_qty: number | null;
  actual_date: string | null;
  status: ReleaseStatus;
  notes: string | null;
  created_at: string;
}

// ── on_time_dispatch_log ──────────────────────────────────────

export interface OnTimeDispatchLog {
  id: string;
  job_id: string;
  dispatched_at: string;
  delivery_date: string | null;
  is_on_time: boolean | null;
  month_key: string;               // 'YYYY-MM'
}

// ── Dashboard ─────────────────────────────────────────────────

export interface DashboardSummary {
  total_active: number;
  on_hold_count: number;
  due_this_week: number;
  dispatched_this_month: number;
  on_time_delivery_rate: number | null;  // percentage 0–100; null if no data
}

// ── Composite types for UI ────────────────────────────────────

// Full job detail with all related data — used in admin history panel
export interface JobDetail extends Job {
  stage_timestamps: JobStageTimestamp[];
  status_logs: JobStatusLog[];
  stage_comments: StageComment[];
  dispatch_schedules: DispatchSchedule[];
}

// ── print_runs ────────────────────────────────────────────────
// Multi-cycle large orders and scheduled releases: each run moves through
// the per-run pipeline (see constants/runStages.ts) independently.

export type PrintRunStage  = RunStage;
export type PrintRunStatus = 'in_progress' | 'dispatched';

export interface PrintRun {
  id:                  string;
  job_id:              string;
  run_number:          number;          // 1, 2, 3… auto-assigned by DB trigger
  qty_this_run:        number;
  qty_remaining_after: number;          // total remaining after this run
  current_stage:       PrintRunStage;
  status:              PrintRunStatus;
  schedule_id:         string | null;   // dispatch_schedules row this run fulfils
  started_at:          string;
  dispatched_at:       string | null;   // set when this run reaches Dispatched
  notes:               string | null;
  qc_remark:           string | null;   // per-release QC remark (set leaving QC)
  created_at:          string;
}

// ── machines / machine_queue_items ───────────────────────────
// Production machine board: dynamic machine list + per-machine job queues.

export interface Machine {
  id:         string;
  name:       string;
  location:   string | null;
  is_active:  boolean;   // false = marked as faulty / not working right now
  is_retired: boolean;   // removed from the board, history preserved
  created_at: string;
  // Normal run rate, used to estimate finish times (migration 010).
  // Optional rather than `number | null` on purpose: until that migration is
  // applied the column does not exist and SELECT * returns no such key.
  labels_per_hour?: number | null;
}

export type MachineQueueStatus = 'queued' | 'printing' | 'done';

export interface MachineQueueItem {
  id:           string;
  machine_id:   string;
  job_id:       string;
  position:     number;                // sequence within the machine's queue
  est_start_at: string | null;         // Production's estimate
  est_end_at:   string | null;
  started_at:   string | null;         // stamped automatically on Start
  completed_at: string | null;         // stamped automatically on Complete
  status:       MachineQueueStatus;
  created_by:   string | null;         // department that queued it
  created_at:   string;
  // joined job info (GET /api/machines)
  jobs?: {
    po_number: string;
    job_name:  string | null;
    party:     string;
    label_qty: number | null;
  } | null;
  // joined machine info (history rows)
  machines?: { name: string; location: string | null } | null;
}

// ── Machine room display (/display/[id]) ─────────────────────
// Lean, read-only slice of one machine's board, sized for the wall
// screens projected in each production room. Deliberately narrower than
// MachineQueueItem: no created_by, no machine join, no history.

export interface MachineDisplayJob {
  po_number:     string;
  job_name:      string | null;
  party:         string;
  label_qty:     number | null;
  delivery_date: string | null;
  urgent:        boolean;
}

export interface MachineDisplayItem {
  id:           string;
  position:     number;
  status:       MachineQueueStatus;
  est_start_at: string | null;
  est_end_at:   string | null;
  started_at:   string | null;
  jobs:         MachineDisplayJob | null;
}

export interface MachineDisplayData {
  machine:  Machine;
  printing: MachineDisplayItem | null;
  queued:   MachineDisplayItem[];
  /** Finished on this machine since midnight IST — the shift tally. */
  completed_today: { count: number; labels: number };
  /** Server clock, so a room PC with a drifting clock still counts up correctly. */
  server_time: string;
}

// ── Machine utilisation report (/admin/machines) ──────────────
// Derived entirely from completed machine_queue_items — the started_at /
// completed_at pair already recorded on every finished run.

export interface MachineUtilisation {
  machine_id:      string;
  machine_name:    string;
  location:        string | null;
  is_active:       boolean;
  labels_per_hour: number | null;
  /** Runs finished in the window. */
  jobs_completed:  number;
  labels_printed:  number;
  /** Summed actual run time, and the mean across runs that had both stamps. */
  printing_ms:     number;
  avg_run_ms:      number | null;
  /** Share of the window actually spent printing, 0–100. */
  utilisation_pct: number | null;
  /**
   * Estimate accuracy over runs that carried both an estimate and actual
   * times: how many finished inside the estimate, and the mean signed
   * deviation as a percentage (negative = faster than estimated).
   */
  estimated_runs:    number;
  within_estimate:   number;
  avg_deviation_pct: number | null;
}

export interface MachineUtilisationReport {
  from:     string;              // 'YYYY-MM-DD' (IST day, inclusive)
  to:       string;              // 'YYYY-MM-DD' (IST day, inclusive)
  machines: MachineUtilisation[];
}

export interface PrintRunStageLog {
  id:           string;
  print_run_id: string;
  stage:        string;
  changed_by:   string | null;          // auth.users id
  changed_at:   string;
  notes:        string | null;
}

// Client-safe slice of print_run_stage_logs — only the fields the public
// tracking portal needs (no changed_by / notes). Fetched server-side with the
// service-role client and passed down to ProductionRunsCard.
export interface RunStageTimestamp {
  print_run_id: string;
  stage:        string;
  changed_at:   string;
}

// ── party_contacts ────────────────────────────────────────────

export interface PartyContact {
  id:           string;
  party:        string;        // matches jobs.party exactly
  contact_name: string | null;
  email:        string | null;
  whatsapp:     string | null; // WATI format: country code + number, no + or spaces
  created_at:   string;
  updated_at:   string;
}

// ── internal_notification_recipients ────────────────────────────

export interface InternalNotificationRecipient {
  id:         string;
  email:      string;
  label:      string | null;
  created_at: string;
}

// ── pending_dispatch_notifications ──────────────────────────────
// Queued per-job dispatch events, consolidated into one email per party
// from /admin/dispatch-notifications. See migration 038.

export interface PendingDispatchNotification {
  id:          string;
  job_id:      string;
  job_name:    string | null;
  po_number:   string;
  party:       string;
  status:      Stage;
  qty:         number | null;
  remark:      string | null;
  created_at:  string;
  notified_at: string | null;
}

// One party's group of pending dispatch notifications, as returned by
// GET /api/dispatch-notifications.
export interface PendingDispatchGroup {
  party: string;
  items: PendingDispatchNotification[];
}

// Status change payload — sent to /api/jobs/[id]/status
export interface StatusChangePayload {
  new_status: Stage;
  dept: Department;
  remark?: string;              // halt_remark or qc_remark
  qty_dispatched?: number;      // Partial Dispatch only
  override_prerequisite?: boolean;  // true = Admin clicked "Skip & Continue"
  override_remark?: string;     // required when override_prerequisite — Admin's justification
  // ── Label stock (optional) ──
  // Partial Dispatch: what Dispatch confirms is physically left on the shelf.
  // Omitted → the route falls back to (label_qty − dispatched_qty).
  stock_remaining_qty?: number;
  // Dispatched: surplus printed beyond the order. 0 or omitted → no extras.
  extra_label_qty?: number;
  extra_label_location?: string;
  extra_label_remark?: string;
}

// ── Bill of Material (BOM) ──────────────────────────────────────
// Production's material requisitions and the owner's answer to them.
// Mirrors supabase/migrations/031_bom_requests.sql.

/** The owner's answer on a single material line. */
export type BomDecision =
  | 'pending'      // not yet answered
  | 'ordered'      // ordering it as asked
  | 'partial'      // ordering less than asked — see approved_quantity
  | 'alternative'  // not this, use alternative_material instead
  | 'rejected';    // not ordering, no substitute

/**
 * Request-level status. Never set by hand — rolled up from the items by the
 * recalc_bom_request_status trigger, except 'cancelled', which the raiser or
 * Admin sets and the rollup will not overwrite.
 */
export type BomRequestStatus =
  | 'pending'
  | 'in_review'
  | 'ordered'
  | 'partially_fulfilled'
  | 'rejected'
  | 'cancelled';

export type BomPriority = 'normal' | 'urgent';

export interface BomRequestItem {
  id:                   string;
  request_id:           string;
  position:             number;
  material:             string;
  specification:        string | null;
  size:                 string | null;
  quantity:             number | null;
  unit:                 string | null;
  note:                 string | null;
  decision:             BomDecision;
  approved_quantity:    number | null;  // set when decision = 'partial'
  alternative_material: string | null;  // set when decision = 'alternative'
  decision_note:        string | null;
  decided_at:           string | null;
  decided_by:           string | null;
  created_at:           string;
  updated_at:           string;
}

export interface BomRequest {
  id:                   string;
  ref:                  string;         // 'BOM-0042'
  job_po:               string | null;  // free text, not a jobs FK
  party:                string | null;
  needed_by:            string | null;  // ISO date, 'YYYY-MM-DD'
  priority:             BomPriority;
  note:                 string | null;
  status:               BomRequestStatus;
  raised_by_department: string;
  raised_by:            string | null;
  cancelled_at:         string | null;
  cancelled_by:         string | null;
  created_at:           string;
  updated_at:           string;
}

/**
 * One entry in the material catalogue (bom_materials) — the single spelling
 * of a material, plus whatever spec/size/unit it was last requested with so
 * picking it can fill the rest of the line in.
 */
export interface BomMaterial {
  id:            string;
  name:          string;
  name_key:      string;   // generated: lower(btrim(name)), unique
  specification: string | null;
  default_size:  string | null;
  default_unit:  string | null;
  created_by:    string | null;
  created_at:    string;
  updated_at:    string;
}

/** What GET /api/bom-requests returns — the header with its lines attached. */
export interface BomRequestWithItems extends BomRequest {
  items: BomRequestItem[];
}

/** What the raise-request form posts to POST /api/bom-requests. */
export interface BomRequestInput {
  job_po?:    string | null;
  party?:     string | null;
  needed_by?: string | null;
  priority?:  BomPriority;
  note?:      string | null;
  items: {
    material:       string;
    specification?: string | null;
    size?:          string | null;
    quantity?:      number | null;
    unit?:          string | null;
    note?:          string | null;
  }[];
}
