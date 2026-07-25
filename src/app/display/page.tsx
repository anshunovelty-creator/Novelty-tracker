// src/app/display/page.tsx
// Picker for the room displays: open this once on a room PC, choose that
// room's machine, then leave it fullscreen. Setup surface only — the machine
// pages themselves carry no navigation.

import Link from 'next/link';
import { listDisplayMachines } from '@/lib/api/machineDisplay';

export const dynamic = 'force-dynamic';

export default async function DisplayIndexPage() {
  const machines = await listDisplayMachines();

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-[var(--glass-ink)]">
        Room displays
      </h1>
      <p className="mt-1 text-sm text-[var(--glass-muted)]">
        Open a machine on that room&rsquo;s screen and put the browser in fullscreen.
        The page keeps itself up to date.
      </p>

      {machines.length === 0 ? (
        <p className="mt-8 text-sm text-[var(--glass-muted)]">
          No machines on the board yet — add one from the dashboard first.
        </p>
      ) : (
        <ul className="mt-8 space-y-2">
          {machines.map((m) => (
            <li key={m.id}>
              <Link
                href={`/display/${m.id}`}
                className="glass flex min-h-[44px] items-center justify-between gap-4 rounded-xl border border-white/10 px-4 py-3 transition-colors hover:bg-white/[0.12] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60 motion-reduce:transition-none"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-[var(--glass-ink)]">
                    {m.name}
                  </span>
                  {m.location && (
                    <span className="block truncate text-xs text-[var(--glass-muted)]">
                      {m.location}
                    </span>
                  )}
                </span>
                <span
                  className={
                    m.is_active
                      ? 'shrink-0 rounded-full bg-emerald-400/15 px-2.5 py-0.5 text-[11px] font-medium text-emerald-200'
                      : 'shrink-0 rounded-full bg-red-400/15 px-2.5 py-0.5 text-[11px] font-medium text-red-200'
                  }
                >
                  {m.is_active ? 'Working' : 'Not working'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
