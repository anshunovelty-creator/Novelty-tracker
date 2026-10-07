'use client';
// src/components/admin/SettingsToc.tsx
// The section list beside Settings. Sticky on a wide screen, a row of chips
// on a phone; the section in view is marked as you scroll.

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export default function SettingsToc({ sections }: { sections: { id: string; label: string }[] }) {
  const [active, setActive] = useState(sections[0]?.id);

  // The last section whose top has passed under the header; at the very
  // bottom of the page, the last section (it may be too short to get there).
  useEffect(() => {
    function onScroll() {
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      let current = sections[0]?.id;
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= 140) current = s.id;
      }
      setActive(atBottom ? sections[sections.length - 1]?.id : current);
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [sections]);

  return (
    <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto lg:flex-col lg:gap-0.5">
      {sections.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          onClick={() => setActive(s.id)}
          aria-current={active === s.id ? 'true' : undefined}
          className={cn(
            'flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-[10px] px-3 text-sm transition-colors',
            active === s.id
              ? 'bg-white font-semibold text-brand-ink shadow-[0_1px_3px_rgba(12,42,32,0.08)]'
              : 'text-brand-muted hover:text-brand-ink',
          )}
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}
