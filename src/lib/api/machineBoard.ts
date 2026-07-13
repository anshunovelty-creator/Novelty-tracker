// src/lib/api/machineBoard.ts
// Shared auth helper for the machine-board API routes (/api/machines/**).
// Route files may only export HTTP handlers, so this lives here.

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { parseDepartment } from '@/lib/constants/departments';
import type { Department } from '@/lib/constants/departments';

// Departments allowed to manage machines and their queues.
export const MACHINE_MANAGERS: Department[] = ['Production', 'Admin'];

export async function requireDept(): Promise<
  { dept: Department } | { error: NextResponse }
> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const dept = parseDepartment(user.user_metadata?.department);
  if (!dept) {
    return { error: NextResponse.json({ error: 'Invalid department in token' }, { status: 403 }) };
  }
  return { dept };
}
