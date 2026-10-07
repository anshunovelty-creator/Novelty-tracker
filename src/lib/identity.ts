// src/lib/identity.ts
// ============================================================
// Who a login is, read only from app_metadata — the part of a Supabase
// account that only the server (service role) can write. user_metadata is
// writable by the user themself, so a department or username read from it
// could be anything they chose (migration 076).
//
// Works on any account shape that carries app_metadata: the signed-in user
// from getClaimsUser(), or a full User from admin.listUsers()/getUserById().
// ============================================================

type WithAppMeta = { app_metadata?: Record<string, unknown> | null } | null | undefined;

/** The login's department key (e.g. 'dispatch'), or undefined if none is set. */
export function deptKeyOf(user: WithAppMeta): string | undefined {
  const d = user?.app_metadata?.department;
  return typeof d === 'string' && d ? d : undefined;
}

/** The app_metadata to hand to usernameOf(), never null. */
export function appMetaOf(user: WithAppMeta): Record<string, unknown> {
  return user?.app_metadata ?? {};
}
