// src/app/api/jobs/pm-lookup/route.ts
// ============================================================
// GET /api/jobs/pm-lookup?code=PM-45
// PM code typeahead for the Add Job form.
// Returns the most recent job per distinct PM code matching the
// typed prefix — used to autofill repeat orders.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const code = new URL(request.url).searchParams.get('code')?.trim() ?? '';
  if (code.length < 2) {
    return NextResponse.json({ matches: [] });
  }

  // Escape ilike wildcards so user input is treated literally
  const pattern = code.replace(/[%_]/g, '\\$&') + '%';

  const { data, error } = await supabase
    .from('jobs')
    .select('pm_code, party, job_name, job_type, label_qty, created_at')
    .ilike('pm_code', pattern)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('[GET /api/jobs/pm-lookup]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Deduplicate by PM code — rows are newest-first, so the first
  // occurrence of each code is the most recent job for it.
  const seen = new Set<string>();
  const matches: typeof data = [];
  for (const row of data ?? []) {
    if (!row.pm_code || seen.has(row.pm_code)) continue;
    seen.add(row.pm_code);
    matches.push(row);
    if (matches.length >= 6) break;
  }

  return NextResponse.json({ matches });
}
