'use client';
// src/components/display/NightDim.tsx
// Dims the wall displays from 19:00 to 07:00 IST. A full-brightness green
// screen in an empty, dark room overnight is glare for the night shift and
// wears the panel; at 62% it still reads across the room.
//
// The plant's clock, not the screen's: the hour is taken in Asia/Kolkata.
// Add ?night=off to the display URL for a screen that must stay bright.

import { useEffect, useState } from 'react';
import { Moon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isNightHour } from '@/lib/nightHours';


export default function NightDim({ children }: { children: React.ReactNode }) {
  const [night, setNight] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('night') === 'off') return;
    const check = () => setNight(isNightHour());
    check();
    const t = setInterval(check, 60_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div
      className={cn(
        'transition-[filter] duration-[2000ms] motion-reduce:transition-none',
        night && '[filter:brightness(.62)_saturate(.75)]',
      )}
    >
      {children}
      {night && (
        <span className="fixed bottom-3 left-3 z-20 flex items-center gap-2 rounded-full border border-white/15 px-3 py-1 text-xs text-[var(--glass-muted)]">
          <Moon className="h-3.5 w-3.5" aria-hidden="true" />
          Night · dimmed 19:00–07:00
        </span>
      )}
    </div>
  );
}
