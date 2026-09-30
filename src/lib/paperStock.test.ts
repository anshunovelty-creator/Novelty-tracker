// src/lib/paperStock.test.ts
// Paper roll stock: the per material + width summary, the per-material
// fold, and a job's metres against the rack (need, suggestion, shortfall,
// and the issue / return tally).

import { describe, expect, it } from 'vitest';
import type { PaperRoll } from './types';
import {
  stockKey, summariseStock, groupStockByMaterial, describeRolls, formatMeters,
  stockNeed, suggestedIssue, stockShortfall, stockCoverPct, stockUsage,
} from './paperStock';

let seq = 0;
function roll(p: Partial<PaperRoll> & Pick<PaperRoll, 'material_id' | 'width_mm' | 'remaining_meter'>): PaperRoll {
  seq += 1;
  return {
    id: `r${seq}`, ref: `R-${String(seq).padStart(4, '0')}`,
    material_name: p.material_id === 'm-am' ? 'AM89240F' : 'Chromo Paper',
    initial_meter: 2000, location: null, supplier: null, note: null, source_request_id: null,
    received_at: '2026-09-01T10:00:00Z', created_by: null,
    ...p,
  };
}

describe('stockKey', () => {
  it('110 and "110.00" are the same width', () => {
    expect(stockKey('m-am', '110.00')).toBe(stockKey('m-am', 110));
    expect(stockKey('m-am', 110)).toBe('m-am|110');
  });

  it('different widths or materials are different lines', () => {
    expect(stockKey('m-am', 110)).not.toBe(stockKey('m-am', 110.5));
    expect(stockKey('m-am', 110)).not.toBe(stockKey('m-ch', 110));
  });
});

describe('summariseStock', () => {
  it('groups live rolls by material + width, counting full and part rolls', () => {
    const lines = summariseStock([
      roll({ material_id: 'm-am', width_mm: 110, remaining_meter: 2000 }),
      roll({ material_id: 'm-am', width_mm: 110, remaining_meter: 2000 }),
      roll({ material_id: 'm-am', width_mm: 110, remaining_meter: 650 }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      key: 'm-am|110', rolls: 3, full_rolls: 2, part_rolls: 1, meters: 4650,
    });
    expect(lines[0].roll_list).toHaveLength(3);
  });

  it('leaves out used-up rolls (0, negative or NaN remaining)', () => {
    const lines = summariseStock([
      roll({ material_id: 'm-am', width_mm: 110, remaining_meter: 0 }),
      roll({ material_id: 'm-am', width_mm: 110, remaining_meter: -5 }),
      roll({ material_id: 'm-am', width_mm: 110, remaining_meter: NaN }),
    ]);
    expect(lines).toEqual([]);
  });

  it('a roll with more than it started with still counts as full', () => {
    const [line] = summariseStock([roll({ material_id: 'm-am', width_mm: 110, remaining_meter: 2050 })]);
    expect(line.full_rolls).toBe(1);
    expect(line.part_rolls).toBe(0);
  });

  it('keeps the metre total to 2 dp as it adds', () => {
    const [line] = summariseStock([
      roll({ material_id: 'm-am', width_mm: 110, remaining_meter: 0.1 }),
      roll({ material_id: 'm-am', width_mm: 110, remaining_meter: 0.2 }),
    ]);
    expect(line.meters).toBe(0.3);
  });

  it('merges widths stored as 110 and "110.00"', () => {
    const lines = summariseStock([
      roll({ material_id: 'm-am', width_mm: 110, remaining_meter: 1000 }),
      roll({ material_id: 'm-am', width_mm: '110.00' as unknown as number, remaining_meter: 500 }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].meters).toBe(1500);
  });

  it('collects distinct locations and the latest receipt', () => {
    const [line] = summariseStock([
      roll({ material_id: 'm-am', width_mm: 110, remaining_meter: 100, location: 'Rack A', received_at: '2026-08-01T00:00:00Z' }),
      roll({ material_id: 'm-am', width_mm: 110, remaining_meter: 100, location: 'Rack A', received_at: '2026-09-15T00:00:00Z' }),
      roll({ material_id: 'm-am', width_mm: 110, remaining_meter: 100, location: null,     received_at: '2026-09-01T00:00:00Z' }),
      roll({ material_id: 'm-am', width_mm: 110, remaining_meter: 100, location: 'Rack B', received_at: '2026-07-01T00:00:00Z' }),
    ]);
    expect(line.locations).toEqual(['Rack A', 'Rack B']);
    expect(line.last_received).toBe('2026-09-15T00:00:00Z');
  });

  it('sorts A→Z by material, then narrow → wide', () => {
    const lines = summariseStock([
      roll({ material_id: 'm-ch', width_mm: 150, remaining_meter: 100 }),
      roll({ material_id: 'm-am', width_mm: 220, remaining_meter: 100 }),
      roll({ material_id: 'm-ch', width_mm: 75,  remaining_meter: 100 }),
      roll({ material_id: 'm-am', width_mm: 110, remaining_meter: 100 }),
    ]);
    expect(lines.map((l) => l.key)).toEqual(['m-am|110', 'm-am|220', 'm-ch|75', 'm-ch|150']);
  });
});

describe('groupStockByMaterial', () => {
  it('folds widths under their material, summing rolls and metres', () => {
    const groups = groupStockByMaterial(summariseStock([
      roll({ material_id: 'm-am', width_mm: 110, remaining_meter: 2000, location: 'Rack A', received_at: '2026-08-01T00:00:00Z' }),
      roll({ material_id: 'm-am', width_mm: 220, remaining_meter: 1500.25, location: 'Rack B', received_at: '2026-09-10T00:00:00Z' }),
      roll({ material_id: 'm-am', width_mm: 220, remaining_meter: 0.1,  location: 'Rack A' }),
      roll({ material_id: 'm-ch', width_mm: 75,  remaining_meter: 800 }),
    ]));
    expect(groups.map((g) => g.material_name)).toEqual(['AM89240F', 'Chromo Paper']);
    expect(groups[0]).toMatchObject({
      rolls: 3, meters: 3500.35, locations: ['Rack A', 'Rack B'], last_received: '2026-09-10T00:00:00Z',
    });
    expect(groups[0].lines.map((l) => l.width_mm)).toEqual([110, 220]);
    expect(groups[1]).toMatchObject({ rolls: 1, meters: 800, locations: [] });
  });

  it('empty stock → no groups', () => {
    expect(groupStockByMaterial([])).toEqual([]);
  });
});

describe('describeRolls', () => {
  it('how the floor says it', () => {
    expect(describeRolls({ rolls: 1, full_rolls: 1, part_rolls: 0 })).toBe('1 roll');
    expect(describeRolls({ rolls: 3, full_rolls: 3, part_rolls: 0 })).toBe('3 rolls');
    expect(describeRolls({ rolls: 1, full_rolls: 0, part_rolls: 1 })).toBe('1 part roll');
    expect(describeRolls({ rolls: 2, full_rolls: 0, part_rolls: 2 })).toBe('2 part rolls');
    expect(describeRolls({ rolls: 5, full_rolls: 4, part_rolls: 1 })).toBe('4 full + 1 part');
  });
});

describe('formatMeters', () => {
  it('Indian grouping, up to 2 dp; dash when unknown', () => {
    expect(formatMeters(24500)).toBe('24,500');
    expect(formatMeters(123456.789)).toBe('1,23,456.79');
    expect(formatMeters(null)).toBe('—');
  });
});

// ── A job against the rack ─────────────────────────────────────────

describe('stockNeed', () => {
  it('running metres less what the job already has from stock', () => {
    expect(stockNeed(2794, 0)).toBe(2794);
    expect(stockNeed(2794, 1000)).toBe(1794);
  });

  it('never negative once the job has enough', () => {
    expect(stockNeed(2794, 2794)).toBe(0);
    expect(stockNeed(2794, 3000)).toBe(0);
  });

  it('no running metres yet → nothing needed', () => {
    expect(stockNeed(null, 0)).toBe(0);
    expect(stockNeed(undefined, 500)).toBe(0);
  });
});

describe('suggestedIssue', () => {
  it('offers the need when the rack covers it', () => {
    expect(suggestedIssue(2794, 8650)).toBe(2794);
  });

  it('caps at what is on the rack', () => {
    expect(suggestedIssue(10000, 8650)).toBe(8650);
  });

  it('nothing needed (no running metres saved) → offers the whole line', () => {
    expect(suggestedIssue(0, 8650)).toBe(8650);
  });
});

describe('stockShortfall', () => {
  it('how far the rack falls short, to 2 dp', () => {
    expect(stockShortfall(10000, 8650.4)).toBe(1349.6);
    expect(stockShortfall(0.3, 0.1)).toBe(0.2);
  });

  it('0 when covered, exactly covered, or nothing needed', () => {
    expect(stockShortfall(2794, 8650)).toBe(0);
    expect(stockShortfall(2794, 2794)).toBe(0);
    expect(stockShortfall(0, 0)).toBe(0);
  });
});

describe('stockCoverPct', () => {
  it('share of the need on the rack, whole percent', () => {
    expect(stockCoverPct(8650, 10000)).toBe(87);   // 86.5 → 87
    expect(stockCoverPct(0, 10000)).toBe(0);
  });

  it('caps at 100', () => {
    expect(stockCoverPct(8650, 2794)).toBe(100);
  });

  it('need of 0 caps at 100 rather than Infinity (the cell only draws the bar when need > 0)', () => {
    expect(stockCoverPct(8650, 0)).toBe(100);
  });
});

describe('stockUsage', () => {
  it('issues are stored negative, returns positive; net is what the job used', () => {
    expect(stockUsage([
      { kind: 'issue',  meters: -4000 },
      { kind: 'issue',  meters: -2000 },
      { kind: 'return', meters: 500 },
    ])).toEqual({ stock_issued_m: 5500, stock_out_m: 6000, stock_returned_m: 500 });
  });

  it('ignores receipts and adjustments — they are not the job’s', () => {
    expect(stockUsage([
      { kind: 'receive', meters: 2000 },
      { kind: 'adjust',  meters: -50 },
      { kind: 'issue',   meters: -1000 },
    ])).toEqual({ stock_issued_m: 1000, stock_out_m: 1000, stock_returned_m: 0 });
  });

  it('reads PostgREST numeric strings', () => {
    const moves = [
      { kind: 'issue',  meters: '-2794.25' },
      { kind: 'return', meters: '94.1' },
    ] as unknown as { kind: string; meters: number }[];
    expect(stockUsage(moves)).toEqual({ stock_issued_m: 2700.15, stock_out_m: 2794.25, stock_returned_m: 94.1 });
  });

  it('rounds each figure to 2 dp', () => {
    expect(stockUsage([
      { kind: 'issue',  meters: -0.1 },
      { kind: 'issue',  meters: -0.2 },
      { kind: 'return', meters: 0.1 },
    ])).toEqual({ stock_issued_m: 0.2, stock_out_m: 0.3, stock_returned_m: 0.1 });
  });

  it('no movements → all zeros', () => {
    expect(stockUsage(null)).toEqual({ stock_issued_m: 0, stock_out_m: 0, stock_returned_m: 0 });
    expect(stockUsage(undefined)).toEqual({ stock_issued_m: 0, stock_out_m: 0, stock_returned_m: 0 });
    expect(stockUsage([])).toEqual({ stock_issued_m: 0, stock_out_m: 0, stock_returned_m: 0 });
  });
});
