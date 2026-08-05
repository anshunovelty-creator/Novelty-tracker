// src/app/api/team/[id]/route.ts
// ============================================================
// DELETE /api/team/[id] — remove a team member's login. Admin only.
//
// Three ways this can go wrong that no confirmation button alone protects
// against, all rejected here regardless of what the client sends:
//   - an Admin removing their own account out from under themselves
//   - removing the last Admin account, locking everyone out of this page
//   - one Admin removing another on a stray click — Admin accounts have
//     full access, so removing one requires the acting Admin to re-enter
//     their own password, not just a second click
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseDepartment } from '@/lib/constants/departments';

type Params = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params;

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dept = parseDepartment(user.user_metadata?.department);
  if (dept !== 'Admin') {
    return NextResponse.json({ error: 'Only Admin can manage the team' }, { status: 403 });
  }

  if (id === user.id) {
    return NextResponse.json({ error: "You can't remove your own account" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: target, error: lookupError } = await admin.auth.admin.getUserById(id);
  if (lookupError || !target?.user) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  }

  if (parseDepartment(target.user.user_metadata?.department) === 'Admin') {
    const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 200 });
    if (listError) return NextResponse.json({ error: listError.message }, { status: 500 });

    const adminCount = list.users.filter(
      (u) => parseDepartment(u.user_metadata?.department) === 'Admin'
    ).length;

    if (adminCount <= 1) {
      return NextResponse.json(
        { error: 'At least one Admin account must remain' },
        { status: 400 },
      );
    }

    // Verify the ACTING admin's own password. A fresh anon-key client, not
    // the cookie-bound server client — signing in on that would mutate the
    // caller's own session cookies as a side effect of a delete request.
    const body = await request.json().catch(() => ({}));
    const password = typeof body.password === 'string' ? body.password : '';
    if (!password) {
      return NextResponse.json({ error: 'Enter your password to confirm' }, { status: 400 });
    }

    const verifier = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { error: verifyError } = await verifier.auth.signInWithPassword({
      email: user.email!,
      password,
    });
    if (verifyError) {
      return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
    }
  }

  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
