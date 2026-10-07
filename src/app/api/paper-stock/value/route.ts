// src/app/api/paper-stock/value/route.ts
// ============================================================
// GET /api/paper-stock/value — what the paper on the rack is worth: metres
// left × width × the material's ₹/m², in total and per stock line (see
// stockValue in lib/paperStock.ts).
//
// A money total, so it follows the department's "See money totals" feature
// (canDeptSeeMoneyTotals) — the same switch as the Job Separation and BOM
// totals. Without it this answers 403 and the Inventory tab shows no value.
// ============================================================

import { NextResponse } from 'next/server';
import { requirePaperStock } from '@/lib/api/paperStockGate';
import { canDeptSeeMoneyTotals } from '@/lib/constants/departments';
import { stockValue } from '@/lib/paperStock';
import type { PaperRoll } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Raw = Pick<PaperRoll, 'id' | 'material_id' | 'width_mm' | 'remaining_meter'> & {
  material: { name: string; rate_per_sqm: number } | { name: string; rate_per_sqm: number }[] | null;
};

export async function GET() {
  const gate = await requirePaperStock('use');
  if ('error' in gate) return gate.error;
  if (!canDeptSeeMoneyTotals(gate.perms)) {
    return NextResponse.json({ error: 'Your department does not see money totals' }, { status: 403 });
  }

  const { data, error } = await gate.supabase
    .from('paper_rolls')
    .select('id, material_id, width_mm, remaining_meter, material:bom_materials(name, rate_per_sqm)')
    .gt('remaining_meter', 0)
    .limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rates = new Map<string, number>();
  const rolls = ((data ?? []) as unknown as Raw[]).map((r) => {
    const m = Array.isArray(r.material) ? r.material[0] : r.material;
    rates.set(r.material_id, Number(m?.rate_per_sqm ?? 0));
    return {
      id: r.id, material_id: r.material_id, material_name: m?.name ?? 'Unknown material',
      width_mm: Number(r.width_mm), remaining_meter: Number(r.remaining_meter),
    } as PaperRoll;
  });

  return NextResponse.json({ value: stockValue(rolls, rates) });
}
