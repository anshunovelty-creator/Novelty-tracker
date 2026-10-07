// src/lib/stageBlocked.ts
// ============================================================
// Wording for a stage change the server refused because it belongs to
// another department: "Only Dispatch can move a job to Packing". The status
// route builds it; the jobs table shows it in the "not your stage" toast
// with a way to leave that department a note.
// ============================================================

/** Error code the status route attaches to a refused-by-department 403. */
export const NOT_YOUR_STAGE = 'NOT_YOUR_STAGE';

/** "Dispatch" · "Dispatch or QC" · "Dispatch, QC or Admin". */
export function joinOr(names: readonly string[]): string {
  const list = Array.from(new Set(names.filter(Boolean)));
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}`;
}

/** The toast's headline. Falls back to Admin when no floor department holds the stage. */
export function notYourStageTitle(owners: readonly string[], stage: string): string {
  return `Only ${joinOr(owners.length ? owners : ['Admin'])} can move a job to ${stage}`;
}
