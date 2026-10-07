// src/app/api/data-versions/route.ts
// ============================================================
// GET /api/data-versions?names=job_separations,bom_costings
// The change counter of each named table (migration 075) — a few bytes a
// page polls to learn whether its list changed, instead of re-downloading
// the list itself. See hooks/useDataVersions.ts. Any signed-in user: it
// says only "something changed", never what.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { DATA_VERSION_TABLES, type DataVersionTable } from '@/lib/dataVersions';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const names = (request.nextUrl.searchParams.get('names') ?? '')
    .split(',')
    .filter((n): n is DataVersionTable => (DATA_VERSION_TABLES as readonly string[]).includes(n));
  if (names.length === 0) return NextResponse.json({ versions: {} });

  const { data, error } = await createAdminClient()
    .from('data_versions')
    .select('name, version')
    .in('name', names);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const versions: Record<string, number> = {};
  for (const row of data ?? []) versions[row.name] = Number(row.version);
  return NextResponse.json({ versions });
}
