// src/lib/paperStock.ts
// Paper roll stock, summarised per material + width — the one grouping
// both the Inventory tab and the BOM costing sheet read. Shared so "5 rolls
// · 10,000 m" means the same thing in both places.

import type { PaperRoll } from './types';

/** Identity of a stock line. Width goes through Number() so 110 and "110.00" meet. */
export function stockKey(materialId: string, widthMm: number | string): string {
  return `${materialId}|${Number(widthMm)}`;
}

export type StockLine = {
  key:           string;
  material_id:   string;
  material_name: string;
  width_mm:      number;
  rolls:         number;   // rolls with anything left on them
  full_rolls:    number;   // untouched
  part_rolls:    number;   // started
  meters:        number;   // total remaining
  locations:     string[];
  last_received: string | null;
  roll_list:     PaperRoll[];
};

/** Live rolls (remaining > 0) grouped by material + width, A→Z then narrow→wide. */
export function summariseStock(rolls: PaperRoll[]): StockLine[] {
  const byKey = new Map<string, StockLine>();
  for (const roll of rolls) {
    if (!(roll.remaining_meter > 0)) continue;
    const key = stockKey(roll.material_id, roll.width_mm);
    let line = byKey.get(key);
    if (!line) {
      line = {
        key, material_id: roll.material_id, material_name: roll.material_name, width_mm: roll.width_mm,
        rolls: 0, full_rolls: 0, part_rolls: 0, meters: 0, locations: [], last_received: null, roll_list: [],
      };
      byKey.set(key, line);
    }
    line.rolls += 1;
    if (roll.remaining_meter >= roll.initial_meter) line.full_rolls += 1; else line.part_rolls += 1;
    line.meters = Math.round((line.meters + roll.remaining_meter) * 100) / 100;
    if (roll.location && !line.locations.includes(roll.location)) line.locations.push(roll.location);
    if (!line.last_received || roll.received_at > line.last_received) line.last_received = roll.received_at;
    line.roll_list.push(roll);
  }
  return Array.from(byKey.values()).sort(
    (a, b) => a.material_name.localeCompare(b.material_name) || a.width_mm - b.width_mm,
  );
}

export type MaterialGroup = {
  material_id:   string;
  material_name: string;
  rolls:         number;
  meters:        number;
  locations:     string[];
  last_received: string | null;
  lines:         StockLine[];   // one per width, narrow → wide
};

/**
 * Stock lines folded one level up, by material — the Inventory tab's top
 * level ("AM89240F · 3 widths · 24,500 m"). Expects summariseStock's order,
 * so groups come out A→Z and widths narrow→wide.
 */
export function groupStockByMaterial(lines: StockLine[]): MaterialGroup[] {
  const byId = new Map<string, MaterialGroup>();
  for (const line of lines) {
    let group = byId.get(line.material_id);
    if (!group) {
      group = {
        material_id: line.material_id, material_name: line.material_name,
        rolls: 0, meters: 0, locations: [], last_received: null, lines: [],
      };
      byId.set(line.material_id, group);
    }
    group.rolls += line.rolls;
    group.meters = Math.round((group.meters + line.meters) * 100) / 100;
    for (const loc of line.locations) if (!group.locations.includes(loc)) group.locations.push(loc);
    if (line.last_received && (!group.last_received || line.last_received > group.last_received)) {
      group.last_received = line.last_received;
    }
    group.lines.push(line);
  }
  return Array.from(byId.values());
}

// ── A job against the rack ─────────────────────────────────────────

/** Metres a job still needs from stock: running metres less what it already has. Never negative. */
export function stockNeed(runningMeter: number | null | undefined, issued: number): number {
  return Math.max((runningMeter ?? 0) - issued, 0);
}

/** What "Use from stock" offers: the need, capped at what's on the rack — or all of it when nothing's needed. */
export function suggestedIssue(need: number, available: number): number {
  return Math.min(need || available, available);
}

/** Metres the rack is short of the need, rounded to 2 dp. 0 when covered. */
export function stockShortfall(need: number, available: number): number {
  return need > 0 && available < need ? Math.round((need - available) * 100) / 100 : 0;
}

/** How much of the need the rack covers, as a whole percent capped at 100 (the cell's thin bar). */
export function stockCoverPct(available: number, need: number): number {
  return Math.min(100, Math.round((available / need) * 100));
}

/**
 * A job's stock movements → gross out, gross back, and the net it actually
 * used — the chip shows "6,000 out · 500 back" so the floor can see where
 * the paper went. Issues are stored negative and returns positive; other
 * kinds (receive, adjust) aren't the job's. Each rounded to 2 dp.
 */
export function stockUsage(moves: { meters: number; kind: string }[] | null | undefined) {
  let out = 0, back = 0;
  for (const m of moves ?? []) {
    if (m.kind === 'issue')  out  += -Number(m.meters);
    if (m.kind === 'return') back += Number(m.meters);
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return { stock_issued_m: round(out - back), stock_out_m: round(out), stock_returned_m: round(back) };
}

/** "4 full + 1 part" / "3 rolls" — how the floor says it. */
export function describeRolls(line: Pick<StockLine, 'rolls' | 'full_rolls' | 'part_rolls'>): string {
  if (line.part_rolls === 0) return `${line.rolls} roll${line.rolls === 1 ? '' : 's'}`;
  if (line.full_rolls === 0) return `${line.part_rolls} part roll${line.part_rolls === 1 ? '' : 's'}`;
  return `${line.full_rolls} full + ${line.part_rolls} part`;
}

/** Metres with Indian grouping, up to 2 decimals. */
export function formatMeters(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}
