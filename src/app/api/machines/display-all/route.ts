// src/app/api/machines/display-all/route.ts
// ============================================================
// GET — read-only live state for every machine, in one payload, for the
//       rotating supervisor display. Any authenticated department may read it.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { requireDept } from '@/lib/api/machineBoard';
import { getAllMachineDisplayData } from '@/lib/api/machineDisplay';

export async function GET(_request: NextRequest) {
  const auth = await requireDept();
  if ('error' in auth) return auth.error;

  const boards = await getAllMachineDisplayData();

  // Wall screens poll this — never serve a cached board.
  return NextResponse.json({ boards }, { headers: { 'Cache-Control': 'no-store' } });
}
