'use client';
// src/components/display/RotatingDisplay.tsx
// Supervisor screen: one display that cycles through every machine, for an
// office or corridor where you want the whole floor rather than one room.
//   • Reuses MachineDisplay in controlled mode, so the layout and states are
//     the same ones the room screens use — one presentation to maintain.
//   • Fetches all machines in a single request every 2 s, so the cost does not
//     grow with the number of machines on the wall.
//   • Rotation is local: data refreshes every 2 s, the visible machine changes
//     every 15 s, and the two are independent.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { MachineDisplayData } from '@/lib/types';
import MachineDisplay from './MachineDisplay';

const POLL_MS   = 2_000;
const ROTATE_MS = 15_000;

export default function RotatingDisplay({ initial }: { initial: MachineDisplayData[] }) {
  const [boards, setBoards] = useState<MachineDisplayData[]>(initial);
  const [index, setIndex]   = useState(0);
  const inFlightRef = useRef(false);

  const load = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const res = await fetch('/api/machines/display-all', { cache: 'no-store' });
      if (!res.ok) return;                       // keep the last good boards
      const body = await res.json();
      if (Array.isArray(body.boards)) setBoards(body.boards);
    } catch {
      // Network hiccup — MachineDisplay's own staleness notice covers it.
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  // Rotate on its own clock. Nothing to rotate through with 0 or 1 machine.
  useEffect(() => {
    if (boards.length < 2) return;
    const t = setInterval(() => setIndex((i) => i + 1), ROTATE_MS);
    return () => clearInterval(t);
  }, [boards.length]);

  if (boards.length === 0) {
    return (
      <div className="flex h-[100dvh] items-center justify-center p-8 text-center">
        <p className="text-[clamp(1rem,2vw,1.75rem)] text-[var(--glass-muted)]">
          No machines on the board yet.
        </p>
      </div>
    );
  }

  // Modulo at render time rather than on set, so the index stays valid when a
  // machine is added or retired between polls.
  const position = index % boards.length;
  const current  = boards[position];

  return (
    <div className="relative">
      {/* key remounts per machine so the clock/skew effects re-seed cleanly */}
      <MachineDisplay key={current.machine.id} initial={current} controlled />

      {/* Which machine of how many. Absolutely positioned so it cannot disturb
          the one-screen layout underneath. */}
      {boards.length > 1 && (
        <div
          className="pointer-events-none absolute inset-x-0 top-[clamp(0.75rem,min(2vw,3vh),2.5rem)] flex justify-center"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2 rounded-full bg-black/25 px-3 py-1.5 backdrop-blur-sm">
            {boards.map((b, i) => (
              <span
                key={b.machine.id}
                className={cn(
                  'block h-1.5 w-1.5 rounded-full bg-[var(--glass-ink)] transition-opacity motion-reduce:transition-none',
                  i === position ? 'opacity-100' : 'opacity-30'
                )}
              />
            ))}
            <span className="sr-only">
              Showing {current.machine.name}, {position + 1} of {boards.length}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
