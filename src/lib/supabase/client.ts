// src/lib/supabase/client.ts
// Browser-side Supabase client. Used in client components.
// Singleton pattern — one instance per browser session.

import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
