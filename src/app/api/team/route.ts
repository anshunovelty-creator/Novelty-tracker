// src/app/api/team/route.ts
// ============================================================
// GET  /api/team  — list every login account (Admin only)
// POST /api/team  — onboard a new team member (Admin only)
//
// A "team member" here is a Supabase Auth user; department lives in
// user_metadata.department the same way the rest of the app reads it
// (see parseDepartment). There is no separate members table — Auth is
// the source of truth, so onboarding and removing here IS the whole
// account lifecycle.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptManageTeam } from '@/lib/constants/departments';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Returns the response to send back when the caller may not manage the
// team, null when they may (must be signed in AND hold team_manage).
async function denyUnlessAdmin(): Promise<NextResponse | null> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!canDeptManageTeam(perms)) {
    return NextResponse.json({ error: 'Only Admin can manage the team' }, { status: 403 });
  }
  return null;
}

// ── GET ───────────────────────────────────────────────────────
export async function GET() {
  const denied = await denyUnlessAdmin();
  if (denied) return denied;

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const members = (await Promise.all(
    data.users.map(async (u) => {
      const memberPerms = await getDeptPermissions(u.user_metadata?.department);
      return {
        id:              u.id,
        email:           u.email ?? '',
        department:      memberPerms?.key ?? null,
        created_at:      u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
      };
    })
  )).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return NextResponse.json({ members });
}

// ── POST ──────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const denied = await denyUnlessAdmin();
  if (denied) return denied;

  const body = await request.json();

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });
  }

  const deptPerms = await getDeptPermissions(body.department);
  if (!deptPerms) {
    return NextResponse.json({ error: 'Choose a department' }, { status: 400 });
  }
  const department = deptPerms.key;

  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // internal staff accounts — no confirmation email to click
    user_metadata: { department },
  });

  if (error) {
    // Supabase's own message ("User already registered", weak-password
    // policy, etc.) is the accurate one to show — pass it through.
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  return NextResponse.json({
    member: {
      id:              data.user.id,
      email:           data.user.email ?? email,
      department,
      created_at:      data.user.created_at,
      last_sign_in_at: null,
    },
  }, { status: 201 });
}
