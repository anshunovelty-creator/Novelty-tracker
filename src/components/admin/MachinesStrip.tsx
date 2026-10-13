'use client';
// src/components/admin/MachinesStrip.tsx
// The Machines header on the dashboard: how many are running, a link to the
// Machines page, and Hide / Show for the MachineBoard (queues, Start/Complete)
// beneath it — that choice is remembered per browser by DashboardBoard.
// While the board is hidden, `inline` renders the same thing as a run of
// text for the page header's subtitle, so it takes no row of its own.
//
// Reads the same ['machines', ''] query as MachineBoard's live view, so the
// two share one request and one cache.

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Machine, MachineQueueItem } from '@/lib/types';

type BoardData = {
  machines: Machine[];
  queue:    MachineQueueItem[];
};

type Props = {
  boardOpen:     boolean;
  onToggleBoard: () => void;
  boardId:       string;
  inline?:       boolean;
};

export default function MachinesStrip({ boardOpen, onToggleBoard, boardId, inline }: Props) {
  const query = useQuery({
    queryKey: ['machines', ''],
    queryFn: async () => {
      const res = await fetch('/api/machines');
      if (!res.ok) throw new Error('Failed to load machines');
      return (await res.json()) as BoardData;
    },
    refetchInterval: 60_000,
  });

  const machines = (query.data?.machines ?? []).filter((m) => !m.is_retired);
  const queue    = query.data?.queue ?? [];
  const running  = machines.filter((m) => queue.some((q) => q.machine_id === m.id && q.status === 'printing')).length;

  const summary = query.data && machines.length > 0 ? `${running} of ${machines.length} running` : null;

  if (inline) {
    // -my-3 keeps the 44px tap target without making the subtitle line taller.
    const link = 'inline-flex min-h-11 -my-3 items-center rounded-[10px] px-2 font-semibold hover:bg-brand-surface-hover';
    return (
      <span className="inline-flex flex-wrap items-center">
        <span>Machines{summary && <span className="font-mono"> {summary}</span>}</span>
        <Link href="/admin/machines" className={cn(link, 'ml-1 text-brand-muted hover:text-brand-ink')}>All machines</Link>
        <button type="button" onClick={onToggleBoard} aria-expanded={boardOpen} aria-controls={boardId}
          className={cn(link, 'gap-1 text-brand-primary')}>
          Show
          <ChevronDown aria-hidden="true" className="h-4 w-4" />
        </button>
      </span>
    );
  }

  return (
    <section aria-labelledby="machines-strip-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="machines-strip-title" className="text-[15px] font-semibold text-brand-ink">
          Machines
          {summary && <span className="font-normal text-brand-muted"> · {summary}</span>}
        </h2>
        <div className="flex items-center gap-1">
        <Link
          href="/admin/machines"
          className="inline-flex min-h-[44px] items-center rounded-[10px] px-3 text-[13px] font-semibold text-brand-muted hover:bg-brand-surface-hover hover:text-brand-ink"
        >
          All machines
        </Link>
        <button
          type="button"
          onClick={onToggleBoard}
          aria-expanded={boardOpen}
          aria-controls={boardId}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[10px] px-3 text-[13px] font-semibold text-brand-primary hover:bg-brand-surface-hover"
        >
          {boardOpen ? 'Hide' : 'Show'}
          <ChevronDown
            aria-hidden="true"
            className={cn('h-4 w-4 transition-transform motion-reduce:transition-none', boardOpen && 'rotate-180')}
          />
        </button>
        </div>
      </div>
    </section>
  );
}
