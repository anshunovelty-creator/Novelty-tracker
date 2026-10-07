// src/lib/prepressTodoView.ts
// ============================================================
// How the Prepress to-do panel sorts its checklist: open tasks that name a
// job ("#OCT26-14", "#PO3370") are "Blocking a job" and lead; the rest are
// "General"; ticked tasks sit under "Done today" or "Done earlier".
// A job is linked by typing # before its job card or PO number — no schema
// change, and the tag reads naturally in the task text.
// ============================================================

import type { PrepressTodo } from '@/lib/types';

/** "#OCT26-14" tokens in a task, without the #. Emails and "#" alone don't count. */
export function jobTags(task: string): string[] {
  const out: string[] = [];
  const re = /(?:^|[^A-Za-z0-9&])#([A-Za-z0-9][A-Za-z0-9./_-]*[A-Za-z0-9]|[A-Za-z0-9])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(task))) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** The task split into plain text and #tag pieces, for rendering chips in place. */
export function splitTags(task: string): { text: string; tag?: string }[] {
  const parts: { text: string; tag?: string }[] = [];
  const re = /(^|[^A-Za-z0-9&])#([A-Za-z0-9][A-Za-z0-9./_-]*[A-Za-z0-9]|[A-Za-z0-9])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(task))) {
    const start = m.index + m[1].length;
    if (start > last) parts.push({ text: task.slice(last, start) });
    parts.push({ text: `#${m[2]}`, tag: m[2] });
    last = start + 1 + m[2].length;
  }
  if (last < task.length) parts.push({ text: task.slice(last) });
  return parts;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export type TodoGroups = {
  blocking:    PrepressTodo[];
  general:     PrepressTodo[];
  doneToday:   PrepressTodo[];
  doneEarlier: PrepressTodo[];
};

export function groupTodos(todos: readonly PrepressTodo[], now: Date = new Date()): TodoGroups {
  const g: TodoGroups = { blocking: [], general: [], doneToday: [], doneEarlier: [] };
  for (const t of todos) {
    if (t.marked_read_at) {
      (sameDay(new Date(t.marked_read_at), now) ? g.doneToday : g.doneEarlier).push(t);
    } else {
      (jobTags(t.task).length ? g.blocking : g.general).push(t);
    }
  }
  const byDone = (a: PrepressTodo, b: PrepressTodo) => Date.parse(b.marked_read_at!) - Date.parse(a.marked_read_at!);
  g.doneToday.sort(byDone);
  g.doneEarlier.sort(byDone);
  return g;
}

/** The Job Separation fields a #tag needs: enough to name it and to link it. */
export type TagRow = {
  id: string;
  sr_no: string | null;
  party: string;
  po_no: string | null;
  pm_code: string | null;
  material_name: string | null;
  linked_job_id: string | null;
  linked_job_card_number: string | null;
  cancelled_at: string | null;
};

/** How one Job Separation row appears in the # list: "#AUG26-1 — Tapi Pharma · Ointment label · Job AUG26-4". */
export function tagOption(row: TagRow): { handle: string; hint: string; kind: 'job' } {
  const bits = [row.party, row.material_name || row.pm_code || (row.po_no ? `PO ${row.po_no}` : null)];
  if (row.linked_job_card_number) bits.push(`Job ${row.linked_job_card_number}`);
  if (row.cancelled_at) bits.push('cancelled');
  return { handle: row.sr_no ?? '', hint: bits.filter(Boolean).join(' · '), kind: 'job' };
}

/**
 * Where a #tag chip goes. A Sr No whose job has been made opens that job;
 * one not made yet opens its Job Separation row; anything else (an older
 * "#PO3370" tag, or a typo) falls back to searching the dashboard and is
 * shown as unmatched.
 */
export function tagLink(tag: string, rows: ReadonlyMap<string, TagRow>): { href: string; title: string; known: boolean } {
  const row = rows.get(tag.toUpperCase());
  if (!row) {
    return { href: `/admin?q=${encodeURIComponent(tag)}`, title: `No Job Separation row #${tag} — searches jobs instead`, known: false };
  }
  const who = `${row.party}${row.material_name ? ` · ${row.material_name}` : ''}`;
  if (row.linked_job_id) {
    return { href: `/admin/jobs/${row.linked_job_id}`, title: `Open job ${row.linked_job_card_number ?? ''} — ${who}`.replace('  ', ' '), known: true };
  }
  return {
    href: `/admin/job-separation?q=${encodeURIComponent(row.sr_no ?? tag)}`,
    title: `${row.cancelled_at ? 'Cancelled' : 'No job made yet'} — open in Job Separation · ${who}`,
    known: true,
  };
}
