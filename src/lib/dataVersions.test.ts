import { describe, it, expect } from 'vitest';
import { versionSignature, shouldRefetch, DATA_VERSION_TABLES } from './dataVersions';

describe('change-aware refresh', () => {
  it('turns the watched counters into one comparable string', () => {
    expect(versionSignature(['job_separations', 'bom_costings'], { job_separations: 12, bom_costings: 3, bom_materials: 9 }))
      .toBe('job_separations:12|bom_costings:3');
  });

  it('treats a table with no counter yet as 0', () => {
    expect(versionSignature(['bom_material_orders'], {})).toBe('bom_material_orders:0');
  });

  it('never refetches on the first answer — the list was just loaded', () => {
    expect(shouldRefetch(null, 'job_separations:12')).toBe(false);
  });

  it('refetches only when a counter moved', () => {
    expect(shouldRefetch('job_separations:12', 'job_separations:12')).toBe(false);
    expect(shouldRefetch('job_separations:12', 'job_separations:13')).toBe(true);
  });

  it('ignores a failed check', () => {
    expect(shouldRefetch('job_separations:12', null)).toBe(false);
  });

  it('watches the same six tables the migration puts triggers on', () => {
    expect([...DATA_VERSION_TABLES].sort()).toEqual([
      'bom_costings', 'bom_material_orders', 'bom_material_requests',
      'bom_materials', 'job_separations', 'paper_stock_movements',
    ]);
  });
});
