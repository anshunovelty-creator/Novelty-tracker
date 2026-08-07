// src/app/api/parties/route.ts
// ============================================================
// GET  /api/parties            — the master list (any authenticated user)
//      /api/parties?search=ar  — typeahead: names starting with the prefix
// POST /api/parties            — add a party (Prepress or Admin)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseDepartment, canDeptManageJobSeparation } from '@/lib/constants/departments';

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const search = new URL(request.url).searchParams.get('search')?.trim();

  let query = supabase.from('parties').select('*').order('name');
  if (search) {
    // Escape ilike wildcards so a typed % or _ is matched literally, then
    // prefix-match — "type the first letter" is the whole point here.
    const pattern = search.replace(/[%_]/g, '\\$&') + '%';
    query = query.ilike('name', pattern).limit(8);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ parties: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dept = parseDepartment(user.user_metadata?.department);
  if (!dept) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });

  // Same team that owns Job Separation owns the party list that feeds it.
  if (!canDeptManageJobSeparation(dept)) {
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
    .insert({ name, created_by: user.email ?? dept })
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
