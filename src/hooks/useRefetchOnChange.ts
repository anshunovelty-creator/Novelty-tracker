'use client';
// src/hooks/useRefetchOnChange.ts
// ============================================================
// Replaces "re-download the whole list every 30 s" with "ask every 30 s
// whether the list changed, re-download only if it did".
//
// Polls GET /api/data-versions for the tables a page shows (a few bytes;
// counters bumped by triggers — migration 075) and, when any counter moves,
// invalidates the page's list queries so React Query fetches them once.
// Like refetchInterval, the poll pauses while the tab is hidden and catches
// up on focus.
//
// paused: while true (unsaved edits, a write in flight) a change is held,
// not applied — the baseline isn't advanced, so the refetch happens as soon
// as the page un-pauses. Same rule the old refetchInterval={false} gave.
// ============================================================

import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { shouldRefetch, versionSignature, type DataVersionTable } from '@/lib/dataVersions';

const POLL_MS = 30_000;

export function useRefetchOnChange(
  tables:     readonly DataVersionTable[],
  queryKeys:  readonly QueryKey[],
  { paused = false }: { paused?: boolean } = {},
) {
  const queryClient = useQueryClient();
  const names = tables.join(',');

  const versions = useQuery({
    queryKey: ['data-versions', names],
    queryFn: async () => {
      const res  = await fetch(`/api/data-versions?names=${names}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to check for changes');
      return data.versions as Record<string, number>;
    },
    refetchInterval: POLL_MS,
    // The answer is only ever compared with the last one — never shown.
    staleTime: 0,
  });

  const signature = versions.data ? versionSignature(tables, versions.data) : null;
  const seen = useRef<string | null>(null);
  // Keys change identity every render; their content is what matters.
  const keysJson = JSON.stringify(queryKeys);

  useEffect(() => {
    if (signature === null || paused) return;
    if (shouldRefetch(seen.current, signature)) {
      for (const queryKey of JSON.parse(keysJson) as QueryKey[]) {
        queryClient.invalidateQueries({ queryKey });
      }
    }
    seen.current = signature;
  }, [signature, paused, keysJson, queryClient]);
}
