// src/lib/api/machineBoard.ts
// Shared auth helper for the machine-board API routes (/api/machines/**).
// Route files may only export HTTP handlers, so this lives here.

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getDeptPermissions } from '@/lib/constants/departments';
import type { DeptPermissions } from '@/lib/constants/departments';

export async function requireDept(): Promise<
  { perms: DeptPermissions } | { error: NextResponse }
> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!perms) {
    return { error: NextResponse.json({ error: 'Invalid department in token' }, { status: 403 }) };
  }
  return { perms };
}
