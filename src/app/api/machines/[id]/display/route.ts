// src/app/api/machines/[id]/display/route.ts
// ============================================================
// GET — read-only live state for one machine's room display.
//       Any authenticated department may read it; nothing here mutates.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { requireDept } from '@/lib/api/machineBoard';
import { getMachineDisplayData } from '@/lib/api/machineDisplay';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;

  const auth = await requireDept();
  if ('error' in auth) return auth.error;

  const data = await getMachineDisplayData(id);
  if (!data) {
    return NextResponse.json({ error: 'Machine not found' }, { status: 404 });
  }

  // Wall screens poll this every 20 s — never serve a cached board.
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
}
