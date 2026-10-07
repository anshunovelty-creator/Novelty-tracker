// src/lib/supabase/claims.ts
// Drop-in replacement for `supabase.auth.getUser()`.
//
// getUser() always makes a network round-trip to Supabase's Auth server to
// re-verify the session, on every single call. This project's Supabase
// project has been migrated to asymmetric JWT signing keys (ECC P-256), so
// getClaims() can verify the JWT's signature locally (against a JWKS cached
// in memory per server instance) instead — no network call once the JWKS is
// warm. Same trust guarantee, without the latency, and safe to call as many
// times per request as needed (unlike getUser(), which pays the round-trip
// cost every time).
//
// Identity comes from app_metadata, never user_metadata: the signed-in user
// can rewrite their own user_metadata from the browser, so a department or
// username read from there could be anything they like (migration 076).
// Read the department with deptKeyOf(user) from '@/lib/identity'.
//
// A token issued before migration 076 has no department in app_metadata
// (tokens refresh hourly); for that case only, the same app_metadata is read
// from the server's copy of the account instead.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';

export interface ClaimsUser {
  id: string;
  email: string;
  /** Service-role-only metadata: department and username. Safe to trust. */
  app_metadata: Record<string, unknown>;
}

export async function getClaimsUser(
  supabase: SupabaseClient
): Promise<ClaimsUser | null> {
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;

  const { claims } = data;
  let appMeta = (claims.app_metadata as Record<string, unknown> | undefined) ?? {};

  if (typeof appMeta.department !== 'string') {
    const { data: fresh } = await createAdminClient().auth.admin.getUserById(claims.sub);
    appMeta = (fresh?.user?.app_metadata as Record<string, unknown> | undefined) ?? appMeta;
  }

  return {
    id: claims.sub,
    email: claims.email ?? '',
    app_metadata: appMeta,
  };
}
