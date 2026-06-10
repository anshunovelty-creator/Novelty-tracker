// src/lib/utils.ts
// ============================================================
// Shared utilities.
// ============================================================

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, differenceInDays } from 'date-fns';
import { getPrerequisite } from './constants/stages';
import type { Stage } from './constants/stages';
import type { JobType } from './types';

// ── Class name merging ────────────────────────────────────────

/** Merge Tailwind classes safely. Use everywhere instead of template literals. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ── Date formatting ───────────────────────────────────────────

/** Admin panel format: "09-06-2026, 02:45 PM" */
export function formatAdminDate(iso: string | null): string {
  if (!iso) return '—';
  return format(new Date(iso), 'dd-MM-yyyy, hh:mm aa');
}

/** Client portal format: "09 June, 2:45 PM" */
export function formatClientDate(iso: string | null): string {
  if (!iso) return '—';
  return format(new Date(iso), 'dd MMMM, h:mm aa');
}

/** Short date only: "09 Jun 2026" */
export function formatShortDate(iso: string | null): string {
  if (!iso) return '—';
  return format(new Date(iso), 'dd MMM yyyy');
}

/** Month key for analytics: "2026-06" */
export function toMonthKey(date: Date = new Date()): string {
  return format(date, 'yyyy-MM');
}

// ── Delivery countdown ────────────────────────────────────────

export type DeliveryStatus = {
  label: string;
  color: 'green' | 'amber' | 'red' | 'muted';
};

export function getDeliveryCountdown(deliveryDate: string | null): DeliveryStatus {
  if (!deliveryDate) {
    return { label: 'Delivery date to be confirmed', color: 'muted' };
  }

  const target = new Date(deliveryDate);
  const today  = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);

  const diff = differenceInDays(target, today);

  if (diff > 2)  return { label: `Delivery in ${diff} days`, color: 'green' };
  if (diff === 2) return { label: 'Due in 2 days', color: 'amber' };
  if (diff === 1) return { label: 'Due tomorrow', color: 'amber' };
  if (diff === 0) return { label: 'Delivery due today', color: 'amber' };

  const overdue = Math.abs(diff);
  return {
    label: `Overdue by ${overdue} day${overdue > 1 ? 's' : ''}`,
    color: 'red',
  };
}

// ── Quantity formatting ───────────────────────────────────────

/** Format label quantities with Indian comma style: 500000 → "5,00,000" */
export function formatQty(qty: number | null | undefined): string {
  if (qty === null || qty === undefined) return '—';
  return qty.toLocaleString('en-IN');
}

// ── Prerequisite checking ─────────────────────────────────────

/**
 * Returns the missing prerequisite stage name if the prerequisite has not
 * been completed, or null if the move is allowed.
 */
export function getMissingPrerequisite(
  targetStage: Stage,
  completedStages: Stage[],
  jobType: JobType
): Stage | null {
  const prereq = getPrerequisite(targetStage, jobType);
  if (!prereq) return null;
  if (completedStages.includes(prereq)) return null;
  return prereq;
}

// ── Progress bar state ────────────────────────────────────────

export type ProgressBarState = {
  percent: number;
  color:   'black' | 'orange' | 'blue';
  label:   string;
};

export function getProgressBarState(
  percent:       number,
  currentStatus: Stage
): ProgressBarState {
  if (currentStatus === 'On Hold') {
    return { percent, color: 'orange', label: `⏸ Paused at ${percent}%` };
  }
  if (currentStatus === 'Quality Check') {
    return { percent, color: 'blue', label: `🔬 In QC · ${percent}%` };
  }
  return { percent, color: 'black', label: `${percent}% complete` };
}
