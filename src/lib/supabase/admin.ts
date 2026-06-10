// src/lib/supabase/admin.ts
// Service role client — bypasses ALL Row Level Security.
// ONLY import this in API route handlers and server-side code.
// NEVER import in client components. NEVER expose service role key to browser.

import { createClient } from '@supabase/supabase-js';

// This is a module-level singleton. In Next.js, API routes are stateless
// per invocation in serverless, so this is instantiated once per cold start.
let adminClient: ReturnType<typeof createClient> | null = null;

export function createAdminClient() {
  if (adminClient) return adminClient;

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set.');
  }

  adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  return adminClient;
}
