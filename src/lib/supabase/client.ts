// src/lib/supabase/client.ts
// Browser-side Supabase client. Used in client components.
// Singleton pattern — one instance per browser session.

import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    // Realtime's heartbeat runs in a Web Worker: Chrome slows a hidden tab's
    // timers to once a minute, which let the socket time out unnoticed and
    // left background tabs deaf to new notes and messages.
    { realtime: { worker: true } }
  );
}
