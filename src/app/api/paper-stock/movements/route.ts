// src/app/api/paper-stock/movements/route.ts
// ============================================================
// GET /api/paper-stock/movements — the ledger, newest first, for one stock
//     line (?material_id=&width_mm=) or one roll (?roll_id=). Last 100.
//     ?recent=1 — the latest 20 across the whole store, for the Activity feed.
//     bom_use.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { requirePaperStock } from '@/lib/api/paperStockGate';
import type { PaperStockMovement, PaperStockMovementKind } from '@/lib/types';

type RawMovement = {
  id: string;
  roll_id: string;
  kind: PaperStockMovementKind;
  meters: number;
  job_separation_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  roll: RawRoll | RawRoll[] | null;
  job: { sr_no: string | null; party: string } | { sr_no: string | null; party: string }[] | null;
};

type RawRoll = { ref: string; width_mm?: number; material?: { name: string } | { name: string }[] | null };

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export async function GET(request: NextRequest) {
  const gate = await requirePaperStock('use');
  if ('error' in gate) return gate.error;

  const sp = new URL(request.url).searchParams;
  const rollId = sp.get('roll_id');
  const materialId = sp.get('material_id');
  const width = Number(sp.get('width_mm'));

  const recent = sp.get('recent') === '1';

  let query = gate.supabase
    .from('paper_stock_movements')
    .select(
      'id, roll_id, kind, meters, job_separation_id, note, created_by, created_at, ' +
      'roll:paper_rolls!inner(ref, material_id, width_mm, material:bom_materials(name)), job:job_separations(sr_no, party)'
    )
    .order('created_at', { ascending: false })
    .limit(recent ? 20 : 100);

  if (recent) {
    // no filter — the whole store
  } else if (rollId) {
    query = query.eq('roll_id', rollId);
  } else if (materialId && Number.isFinite(width) && width > 0) {
    query = query.eq('roll.material_id', materialId).eq('roll.width_mm', width);
  } else {
    return NextResponse.json({ error: 'Pass roll_id, or material_id and width_mm' }, { status: 400 });
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const movements: PaperStockMovement[] = ((data ?? []) as unknown as RawMovement[]).map((m) => {
    const job = one(m.job);
    const roll = one(m.roll);
    return {
      id:                m.id,
      roll_id:           m.roll_id,
      roll_ref:          roll?.ref ?? null,
      material_name:     one(roll?.material ?? null)?.name ?? null,
      width_mm:          roll?.width_mm ?? null,
      kind:              m.kind,
      meters:            Number(m.meters),
      job_separation_id: m.job_separation_id,
      job_label:         job ? [job.sr_no, job.party].filter(Boolean).join(' · ') : null,
      note:              m.note,
      created_by:        m.created_by,
      created_at:        m.created_at,
    };
  });

  return NextResponse.json({ movements });
}
