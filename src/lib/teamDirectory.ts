// src/lib/teamDirectory.ts
// ============================================================
// Server-only: every login's username and department, plus the department
// tags. Feeds the @ popup and the names beside notes and messages for any
// signed-in user (GET /api/team/directory), and the "is this username free"
// check when Admin sets one.
// ============================================================

import { createAdminClient } from '@/lib/supabase/admin';
import { normalizeUsername, usernameClash, usernameOf, usernameProblem } from '@/lib/username';
import { deptKeyOf, appMetaOf } from '@/lib/identity';

export type DirectoryPerson = {
  id:         string;
  email:      string;
  username:   string;
  department: string | null;
};
export type DirectoryDept = { key: string; display_name: string };

export async function loadDirectory(): Promise<{ people: DirectoryPerson[]; departments: DirectoryDept[] }> {
  const admin = createAdminClient();
  const [users, depts] = await Promise.all([
    admin.auth.admin.listUsers({ perPage: 200 }),
    admin.from('departments').select('key, display_name').order('display_name'),
  ]);
  if (users.error) throw new Error(users.error.message);
  const people = users.data.users.map((u) => ({
    id:         u.id,
    email:      u.email ?? '',
    username:   usernameOf(appMetaOf(u), u.email),
    department: deptKeyOf(u) ?? null,
  }));
  return { people, departments: (depts.data ?? []) as DirectoryDept[] };
}

/**
 * Validate a username Admin typed for login `forId` (null for a new login).
 * Returns the cleaned username, or the reason it can't be used.
 */
export async function checkUsername(raw: unknown, forId: string | null): Promise<{ username: string } | { error: string }> {
  const username = normalizeUsername(raw);
  const bad = usernameProblem(username);
  if (bad) return { error: bad };
  const { people, departments } = await loadDirectory();
  const clash = usernameClash(username, people.filter((p) => p.id !== forId).map((p) => p.username), departments);
  return clash ? { error: clash } : { username };
}
