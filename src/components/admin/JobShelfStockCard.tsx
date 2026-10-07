'use client';
// src/components/admin/JobShelfStockCard.tsx
// "On the shelf for PM-…" on the job page — printed labels of this PM code
// already sitting in Label stock, so nobody prints what's on the rack.
// Only usable stock counts (Extra and Manual); Remaining is promised to
// another open order. Hidden when there is none, or when the department
// can't see stock (the API answers 403 and the card stays away).

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { formatQty } from '@/lib/utils';
import { StateChip } from '@/components/ui/StateChip';
import type { LabelStock } from '@/lib/types';

const KIND_DOT = { Extra: '#059669', Manual: '#64748B', Remaining: '#D97706' } as const;

export default function JobShelfStockCard({ pmCode, jobId }: { pmCode: string | null; jobId: string }) {
  const code = pmCode?.trim() ?? '';
  const q = useQuery({
    queryKey: ['stock', 'pm', code],
    enabled: code.length > 0,
    queryFn: async () => {
      const res = await fetch(`/api/stock?search=${encodeURIComponent(code)}`);
      if (!res.ok) return [] as LabelStock[];
      const data = await res.json();
      return ((data.stock ?? []) as LabelStock[]).filter(
        (s) => s.pm_code?.trim().toUpperCase() === code.toUpperCase() && s.kind !== 'Remaining' && s.job_id !== jobId,
      );
    },
    staleTime: 60_000,
  });

  const rows = q.data ?? [];
  if (!code || rows.length === 0) return null;
  const total = rows.reduce((n, s) => n + s.qty, 0);

  return (
    <section aria-label="Shelf stock" className="flex flex-col gap-2.5 rounded-2xl border border-brand-border bg-white p-5 shadow-[0_2px_8px_rgba(12,42,32,0.04)]">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-brand-ink">On the shelf for <span className="font-mono">{code}</span></h2>
        <span className="font-mono text-sm font-semibold text-brand-ink">{formatQty(total)}</span>
      </div>
      <ul className="flex flex-col gap-2">
        {rows.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3">
            <StateChip label={s.kind} dot={KIND_DOT[s.kind]} />
            <span className="min-w-0 flex-1 truncate text-[13px] text-brand-muted">
              {s.job_card_number ? <>From <span className="font-mono">{s.job_card_number.toUpperCase()}</span></> : 'Added by hand'}
              {s.location && <> · rack <span className="font-mono">{s.location}</span></>}
            </span>
            <span className="font-mono text-sm font-semibold text-brand-ink">{formatQty(s.qty)}</span>
          </li>
        ))}
      </ul>
      <p className="text-[13px] text-brand-muted">
        Usable now. Stock promised to other open orders isn&rsquo;t counted.{' '}
        <Link href={`/admin/stock?q=${encodeURIComponent(code)}`} className="font-semibold text-brand-primary underline-offset-2 hover:underline">Open in Label stock</Link>
      </p>
    </section>
  );
}
