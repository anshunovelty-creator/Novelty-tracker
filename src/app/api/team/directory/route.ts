// src/app/api/team/directory/route.ts
// GET /api/team/directory — every login's username and department, plus the
// department tags. Any signed-in user: it is what the @ popup offers and how
// a note or message shows who wrote it. No sign-in times or other account
// detail — that stays behind Admin-only GET /api/team.

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { loadDirectory } from '@/lib/teamDirectory';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    return NextResponse.json(await loadDirectory());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
