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
// Returns the same shape callers already destructure elsewhere in the app
// (id / email / user_metadata) so existing `user.id`, `user.email`,
// `user.user_metadata?.department` usages keep working unchanged.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ClaimsUser {
  id: string;
  email: string;
  user_metadata: Record<string, unknown>;
}

export async function getClaimsUser(
  supabase: SupabaseClient
): Promise<ClaimsUser | null> {
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;

  const { claims } = data;
  return {
    id: claims.sub,
    email: claims.email ?? '',
    user_metadata: (claims.user_metadata as Record<string, unknown>) ?? {},
  };
}
