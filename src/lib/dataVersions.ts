// src/lib/dataVersions.ts
// ============================================================
// The tables with a change counter (migration 075), and how a page turns
// their counters into "refetch now?". Pure, so the hook and its tests share
// the rule.
// ============================================================

/** Must match the trigger list in supabase/migrations/075_data_versions.sql. */
export const DATA_VERSION_TABLES = [
  'job_separations', 'bom_costings', 'bom_materials',
  'bom_material_requests', 'bom_material_orders', 'paper_stock_movements',
] as const;
export type DataVersionTable = typeof DATA_VERSION_TABLES[number];

/** One string standing for every watched counter, so "changed?" is a string compare. */
export function versionSignature(names: readonly DataVersionTable[], versions: Record<string, number>): string {
  return names.map((n) => `${n}:${versions[n] ?? 0}`).join('|');
}

/**
 * Whether a page should refetch: only when a signature it had already seen
 * is replaced by a different one. The first answer after load is a baseline
 * (the list was just fetched), and a failed poll (null) never triggers.
 */
export function shouldRefetch(previous: string | null, next: string | null): boolean {
  return previous !== null && next !== null && previous !== next;
}
