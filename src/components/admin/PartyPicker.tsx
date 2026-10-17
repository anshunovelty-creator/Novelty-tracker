'use client';
// src/components/admin/PartyPicker.tsx
// Type any part of a party's name — "85" or "PL 85" finds UPL 85 — and pick
// it from the list. Stands in for a <select> over an already-loaded parties
// list, so `value` is only ever a picked (or exactly typed) party, or ''.

import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { nameMatches, startsFirst } from '@/lib/search';
import { useListKeys } from '@/hooks/useListKeys';
import type { Party } from '@/lib/types';

export default function PartyPicker({ parties, value, onChange, className }: {
  parties: Party[];
  value: string;
  onChange: (name: string) => void;
  className?: string;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);

  // A party set from outside (an order picked elsewhere in the form) shows here.
  useEffect(() => { if (value) setQuery(value); }, [value]);

  const matches = useMemo(() => {
    const q = query.trim();
    return q ? startsFirst(parties.filter((p) => nameMatches(p.name, q)), q) : parties;
  }, [parties, query]);

  function pick(p: Party) {
    setQuery(p.name);
    onChange(p.name);
    setOpen(false);
  }

  const keys = useListKeys({ items: matches, open, onPick: pick, onClose: () => setOpen(false) });

  return (
    <div className="relative">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          const exact = parties.find((p) => p.name.toLowerCase() === e.target.value.trim().toLowerCase());
          onChange(exact?.name ?? '');
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Type any part of the name"
        autoComplete="off"
        aria-label="Party"
        {...keys.inputProps}
        className={className}
      />
      {open && (
        <div {...keys.listProps} className="absolute z-20 top-full left-0 right-0 mt-1 glass-strong glass rounded-lg shadow-lg overflow-hidden max-h-56 overflow-y-auto">
          {matches.length > 0 ? matches.map((p, i) => (
            <button
              key={p.id}
              type="button"
              {...keys.optionProps(i)}
              // onMouseDown fires before the input's onBlur closes the list
              onMouseDown={(e) => { e.preventDefault(); pick(p); }}
              className={cn(
                'w-full min-h-11 text-left px-3 py-2 text-sm text-[var(--glass-ink)] transition-colors border-b border-white/10 last:border-0',
                i === keys.active && 'bg-brand-surface-hover shadow-[inset_3px_0_0_#10553F]',
              )}
            >
              {p.name}
            </button>
          )) : (
            <p className="px-3 py-2 text-xs text-[var(--glass-muted)]">No party with that in its name.</p>
          )}
        </div>
      )}
      {!value && query.trim() && !open && (
        <p className="text-xs text-amber-200 mt-1">Pick the party from the list.</p>
      )}
    </div>
  );
}
