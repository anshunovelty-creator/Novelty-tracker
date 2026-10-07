'use client';
// src/components/admin/MessagesWidget.tsx
// ============================================================
// Floating launcher for team messaging — same FAB stack as NotesFeed,
// PrepressTodoPanel and MeterCalculatorPanel (bottom-right, 76px rhythm),
// in the bottom slot (bottom-5) — notes open from the header now — since both are
// global, layout-mounted widgets every login sees. Previously lived as a
// small icon in AdminHeader; moved here so it's thumb-reachable and never
// buried among the header's other controls (PRODUCT.md principle 4,
// "fast on the floor" — reachable with a thumb, not a search).
//
// One Realtime subscription lives here — not per-drawer — so the badge
// stays live even while the drawer is closed. It's a plain "something
// changed, go refetch" nudge (same shape as PrepressTodoPanel's), not a
// stream of diffs: simpler, and message volume here is nowhere near
// where that would matter.
// ============================================================

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { requestOpen, subscribeActiveWidget } from '@/lib/floatingWidgetCoordinator';

// Loaded on first open, not with every admin page — the drawer only renders
// once the launcher is used. preloadDrawer warms the chunk on hover/focus so
// the first open doesn't wait on the network.
const loadDrawer = () => import('./MessagesDrawer');
const MessagesDrawer = dynamic(loadDrawer, { ssr: false });
const preloadDrawer = () => { void loadDrawer(); };

// messages + conversation_participants are in the realtime publication, so
// the channel below is the primary signal; this poll only covers a dropped
// socket.
const POLL_MS = 120_000;

type Props = {
  userEmail:    string;
  isSuperAdmin: boolean;
};

export default function MessagesWidget({ userEmail, isSuperAdmin }: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: unread = 0 } = useQuery({
    queryKey: ['messages', 'unread-count'],
    queryFn: async () => {
      const res = await fetch('/api/messages/unread-count');
      if (!res.ok) throw new Error('Failed to load unread count');
      const data = await res.json();
      return data.count ?? 0;
    },
    refetchInterval: POLL_MS,
  });

  // Realtime nudge: any insert on messages (a reply, or a brand new thread's
  // first message) or conversation_participants (being tagged into a new
  // thread) invalidates every ['messages', ...] query. RLS already scopes
  // what this session receives to conversations it's actually in, so a
  // delivered event always means "something changed for me" — see
  // migration 059's Realtime note.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('messages_changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
        queryClient.invalidateQueries({ queryKey: ['messages'] });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversation_participants' }, () => {
        queryClient.invalidateQueries({ queryKey: ['messages'] });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  useEffect(() => {
    if (!open) return;
    return subscribeActiveWidget((activeId) => {
      if (activeId !== 'messages') setOpen(false);
    });
  }, [open]);

  function handleOpen() {
    requestOpen('messages');
    setOpen(true);
  }

  // ── Launcher — the bottom slot (bottom-5), now that notes open from the header; the
  // two never overlap; PrepressTodoPanel and MeterCalculatorPanel shift
  // panels above sit one slot up each (bottom-24 / bottom-[172px]). ──
  if (!open) {
    return (
      <button
        onClick={handleOpen}
        onPointerEnter={preloadDrawer}
        onFocus={preloadDrawer}
        aria-label={unread > 0 ? `Messages, ${unread} unread` : 'Messages'}
        className={cn(
          'admin-fab fixed bottom-5 right-5 z-40 h-14 w-14 rounded-full',
          'bg-brand-primary hover:bg-brand-primary-hover text-white',
          'shadow-lg shadow-black/20 flex items-center justify-center',
          'transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-primary/40',
        )}
      >
        <MessageCircle className="h-6 w-6" aria-hidden="true" />
        {unread > 0 && (
          <span
            className={cn(
              'absolute -top-1 -right-1 min-w-[22px] h-[22px] px-1 rounded-full',
              'bg-brand-danger text-white text-[11px] font-semibold leading-[22px]',
              'ring-2 ring-white',
            )}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
    );
  }

  return (
    <MessagesDrawer
      userEmail={userEmail}
      isSuperAdmin={isSuperAdmin}
      onClose={() => setOpen(false)}
    />
  );
}
