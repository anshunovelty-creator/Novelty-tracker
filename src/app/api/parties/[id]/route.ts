// src/app/api/parties/[id]/route.ts
// ============================================================
// DELETE /api/parties/[id] — remove a party from the master list.
// Prepress or Admin only.
//
// job_separations.party is free TEXT, not a foreign key to this table,
// so removing a party here only affects what the typeahead offers next
// time — it never touches a row already saved with that name.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseDepartment, canDeptManageJobSeparation } from '@/lib/constants/departments';

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dept = parseDepartment(user.user_metadata?.department);
  if (!dept) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });

  if (!canDeptManageJobSeparation(dept)) {
    return NextResponse.json(
      { error: 'Only Prepress or Admin can remove parties' },
      { status: 403 }
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin.from('parties').delete().eq('id', id).select('id');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: 'Party not found' }, { status: 404 });

  return NextResponse.json({ ok: true });
}
