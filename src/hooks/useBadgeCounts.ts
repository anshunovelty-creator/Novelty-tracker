'use client';
// src/hooks/useBadgeCounts.ts
// Header badge counts (pending BOM requests, parties waiting on a dispatch
// email) kept current by Supabase Realtime instead of a tight poll.
//
// The count itself is always computed server-side by the existing
// ?count=pending branch of each API route. Realtime is only a nudge: any
// INSERT/UPDATE/DELETE on the backing table invalidates the query (debounced,
// so a bulk "order these five requests" is one refetch, not five). RLS scopes
// what the socket delivers — bom_material_requests is readable only with
// bom_use, pending_dispatch_notifications only with dispatch_notifications,
// the same gates the API routes check — so a session only ever subscribes
// to rows it could already fetch.
//
// Self-healing, in case the socket drops or the table is not yet in the
// supabase_realtime publication (see migration 068_realtime_badges.sql):
//   - a slow fallback poll (react-query pauses it while the tab is hidden);
//   - a refetch when the tab becomes visible again, if the count is stale;
//   - a refetch whenever the channel (re)subscribes, to catch anything that
//     happened while it was disconnected.
//
// Several components can read the same count (AdminHeader and BomTabs both
// show the BOM number). They share one react-query key, so one fetch serves
// both, and a ref-counted registry keeps it to one Realtime channel per
// table however many of them are mounted.

import { useEffect } from 'react';
import { useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

/** Fallback only — Realtime is the primary signal. */
const FALLBACK_POLL_MS = 2 * 60_000;
/** Collapse a burst of row changes into a single count refetch. */
const DEBOUNCE_MS = 500;

type BadgeSource = {
  queryKey: QueryKey;
  url:      string;
  table:    string;
};

const BOM_PENDING: BadgeSource = {
  queryKey: ['bom-requests', 'pending-count'],
  url:      '/api/bom-requests?count=pending',
  table:    'bom_material_requests',
};

const DISPATCH_PENDING: BadgeSource = {
  queryKey: ['dispatch-notifications', 'pending-count'],
  url:      '/api/dispatch-notifications?count=pending',
  table:    'pending_dispatch_notifications',
};

// ---- one channel per table, shared by every mounted reader ----------------

type LiveEntry = {
  refs:     number;
  supabase: ReturnType<typeof createClient>;
  channel: RealtimeChannel;
  timer:   ReturnType<typeof setTimeout> | null;
};

const live = new Map<string, LiveEntry>();

function retain(source: BadgeSource, queryClient: QueryClient): () => void {
  const existing = live.get(source.table);
  if (existing) {
    existing.refs += 1;
    return () => release(source.table);
  }

  const supabase = createClient();
  const entry: LiveEntry = { refs: 1, supabase, channel: null as unknown as RealtimeChannel, timer: null };

  const refetch = () => {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      queryClient.invalidateQueries({ queryKey: source.queryKey, exact: true });
    }, DEBOUNCE_MS);
  };

  // Unique per subscription so a fast unmount/remount (React strict mode,
  // a route change) never collides with a channel still being torn down.
  const name = `badge:${source.table}:${Math.random().toString(36).slice(2, 10)}`;

  let subscribedOnce = false;
  entry.channel = supabase
    .channel(name)
    .on('postgres_changes', { event: '*', schema: 'public', table: source.table }, refetch)
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        // The first subscribe coincides with the initial fetch; a later one
        // is a reconnect, and anything missed while offline needs a recount.
        if (subscribedOnce) refetch();
        subscribedOnce = true;
      }
      // CHANNEL_ERROR / TIMED_OUT / CLOSED: nothing to do — supabase-js
      // retries on its own, and the 2-minute fallback poll covers the gap
      // (including the rare binding-mismatch error it never rejoins from).
    });

  live.set(source.table, entry);
  return () => release(source.table);
}

function release(table: string) {
  const entry = live.get(table);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;
  if (entry.timer) clearTimeout(entry.timer);
  live.delete(table);
  void entry.supabase.removeChannel(entry.channel);
}

// ---- hooks ----------------------------------------------------------------

function useLiveCount(source: BadgeSource, enabled: boolean): number {
  const queryClient = useQueryClient();

  const { data = 0 } = useQuery({
    queryKey: source.queryKey,
    queryFn: async () => {
      const res = await fetch(source.url);
      if (!res.ok) throw new Error(`Failed to load ${source.url}`);
      const body = await res.json();
      return (body.pending ?? 0) as number;
    },
    enabled,
    // Paused while the tab is hidden (refetchIntervalInBackground is off).
    refetchInterval: FALLBACK_POLL_MS,
    // The app turns this off globally; a badge wants it back, so returning
    // to a tab after a dropped socket shows the right number. Still gated
    // on staleTime, so flicking between tabs doesn't refetch every time.
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!enabled) return;
    return retain(source, queryClient);
  }, [enabled, source, queryClient]);

  return data;
}

/** Material requests still awaiting an answer. Pass canDeptUseBOM(dept). */
export function useBomPendingCount(enabled = true): number {
  return useLiveCount(BOM_PENDING, enabled);
}

/** Parties with a dispatch batch waiting to be emailed. Pass canDeptManageDispatchNotifications(dept). */
export function useDispatchPendingCount(enabled = true): number {
  return useLiveCount(DISPATCH_PENDING, enabled);
}
