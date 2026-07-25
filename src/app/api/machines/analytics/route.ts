// src/app/api/machines/analytics/route.ts
// ============================================================
// GET — per-machine utilisation for an IST date range (both days inclusive).
//       ?from=YYYY-MM-DD&to=YYYY-MM-DD, defaulting to the last 7 days.
//       Read-only; any authenticated department may read it, matching the
//       machine board being visible to everyone.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { requireDept } from '@/lib/api/machineBoard';
import { getMachineUtilisation, istToday, istDaysBefore } from '@/lib/api/machineAnalytics';

export async function GET(request: NextRequest) {
  const auth = await requireDept();
  if ('error' in auth) return auth.error;

  const today = istToday();
  const from  = request.nextUrl.searchParams.get('from') ?? istDaysBefore(today, 6);
  const to    = request.nextUrl.searchParams.get('to')   ?? today;

  try {
    const report = await getMachineUtilisation(from, to);
    return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    // getMachineUtilisation throws only on a bad range — a client mistake.
    const message = err instanceof Error ? err.message : 'Invalid date range';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
