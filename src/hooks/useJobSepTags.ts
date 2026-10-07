'use client';
// src/hooks/useJobSepTags.ts
// The Prepress to-do's #tags, backed by the Job Separation worksheet:
//   useJobSepTagSearch — rows matching what's typed after #, for the list;
//   useJobSepTagRows   — the rows the saved tags name, so chips can link.
// Both are reads of GET /api/job-separations; nothing is stored beyond the
// tag text in the task itself.

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { tagOption, type TagRow } from '@/lib/prepressTodoView';
import type { MentionOption } from '@/lib/mentionInput';

async function rowsFrom(url: string): Promise<TagRow[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not load Job Separation');
  return ((await res.json()).job_separations ?? []) as TagRow[];
}

/**
 * Up to six rows for `query` (null = no # being typed). A bare # lists this
 * month's newest rows; anything typed searches every row by Sr No, party,
 * PO, PM code or material — the worksheet's own "All fields" search.
 */
export function useJobSepTagSearch(query: string | null): MentionOption[] {
  const [q, setQ] = useState(query);
  useEffect(() => {
    const t = setTimeout(() => setQ(query), 200);
    return () => clearTimeout(t);
  }, [query]);

  const { data = [] } = useQuery({
    queryKey: ['job-sep-tags', q],
    queryFn: () => rowsFrom(q
      ? `/api/job-separations?search=${encodeURIComponent(q)}&range=all&limit=6`
      : '/api/job-separations?range=month&limit=6'),
    enabled: q !== null,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  return useMemo(
    () => (query === null ? [] : data.filter((r) => r.sr_no).map(tagOption)),
    [data, query],
  );
}

/** Sr No (upper case) → row, for every tag named in `tags`. */
export function useJobSepTagRows(tags: readonly string[]): Map<string, TagRow> {
  const key = Array.from(new Set(tags.map((t) => t.toUpperCase()))).sort().join(',');
  const { data = [] } = useQuery({
    queryKey: ['job-sep-by-srno', key],
    queryFn: () => rowsFrom(`/api/job-separations?sr_nos=${encodeURIComponent(key)}`),
    enabled: key !== '',
    staleTime: 60_000,
  });
  return useMemo(() => new Map(data.filter((r) => r.sr_no).map((r) => [r.sr_no!.toUpperCase(), r])), [data]);
}
