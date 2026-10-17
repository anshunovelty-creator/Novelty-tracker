// src/app/api/parties/route.ts
// ============================================================
// GET  /api/parties            — the master list (any authenticated user)
//      /api/parties?search=ar  — typeahead: names containing the text, prefix matches first
// POST /api/parties            — add a party (Prepress or Admin)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptManageJobSeparation } from '@/lib/constants/departments';
import { deptKeyOf } from '@/lib/identity';
import { nameMatches, startsFirst } from '@/lib/search';

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const search = new URL(request.url).searchParams.get('search')?.trim();

  const { data, error } = await supabase.from('parties').select('*').order('name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!search) return NextResponse.json({ parties: data ?? [] });

  // Any part of the name, spaces and dashes ignored — "53" or "PL 53" finds
  // "UPL - 53"; names starting with the text come first.
  // ponytail: filters the whole list in code (~50 rows); move to SQL if it grows into the thousands.
  const hits = (data ?? []).filter((p) => nameMatches(p.name, search));
  return NextResponse.json({ parties: startsFirst(hits, search).slice(0, 8) });
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!perms) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });

  // Same team that owns Job Separation owns the party list that feeds it.
  if (!canDeptManageJobSeparation(perms)) {
    return NextResponse.json(
      { error: 'Only Prepress or Admin can add parties' },
      { status: 403 }
    );
  }

  const body = await request.json();
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'Party name is required' }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('parties')
    .insert({ name, created_by: user.email ?? perms.key })
    .select()
    .single();

  if (error) {
    // Someone already added this name — case-insensitive collision on the
    // unique index. Hand back the existing row so the picker in the
    // caller can still select it, instead of surfacing a raw conflict.
    if (error.code === '23505') {
      const escaped = name.replace(/[%_]/g, '\\$&');
      const { data: existing, error: lookupError } = await admin
        .from('parties')
        .select('*')
        .ilike('name', escaped)
        .limit(1)
        .maybeSingle();
      if (existing) return NextResponse.json({ party: existing });
      if (lookupError) return NextResponse.json({ error: lookupError.message }, { status: 500 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ party: data }, { status: 201 });
}
