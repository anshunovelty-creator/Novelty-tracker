// src/lib/types.ts
// ============================================================
// TypeScript interfaces — one per database table + select views.
// These are the canonical types used across the entire codebase.
// Never use 'any'. Extend these as needed, never weaken them.
// ============================================================

import type { Stage } from './constants/stages';
import type { Department } from './constants/departments';

// ── jobs ─────────────────────────────────────────────────────

export type JobType = 'New' | 'Repeat' | 'Artwork Changed';

export interface Job {
  id: string;
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

// Form data for Add Job — subset of Job used in the form
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
  created_at: string;
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
// Multi-cycle large orders: each run moves through
// Printing → QC → Packing → Dispatched independently.

export type PrintRunStage  = 'Printing' | 'QC' | 'Packing' | 'Dispatched';
export type PrintRunStatus = 'in_progress' | 'dispatched';

export interface PrintRun {
  id:                  string;
  job_id:              string;
  run_number:          number;          // 1, 2, 3… auto-assigned by DB trigger
  qty_this_run:        number;
  qty_remaining_after: number;          // total remaining after this run
  current_stage:       PrintRunStage;
  status:              PrintRunStatus;
  started_at:          string;
  dispatched_at:       string | null;   // set when this run reaches Dispatched
  notes:               string | null;
  created_at:          string;
}

export interface PrintRunStageLog {
  id:           string;
  print_run_id: string;
  stage:        string;
  changed_by:   string | null;          // auth.users id
  changed_at:   string;
  notes:        string | null;
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

// Status change payload — sent to /api/jobs/[id]/status
export interface StatusChangePayload {
  new_status: Stage;
  dept: Department;
  remark?: string;              // halt_remark or qc_remark
  qty_dispatched?: number;      // Partial Dispatch only
  override_prerequisite?: boolean;  // true = Admin clicked "Skip & Continue"
  override_remark?: string;     // required when override_prerequisite — Admin's justification
}
