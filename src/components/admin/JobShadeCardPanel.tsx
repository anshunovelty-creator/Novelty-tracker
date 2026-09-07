'use client';
// src/components/admin/JobShadeCardPanel.tsx
// The shade card cross-reference on a job.
//
// Read-only on purpose. The job pipeline has its own "Shade Card Sent" and
// "Shade Card Approved" stages, and those are client-notification triggers —
// so this panel reports what the shade card register says and stops there.
// Advancing the job stays a deliberate act on the job itself.

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Palette, ExternalLink } from 'lucide-react';
import { cn, formatNumericDate } from '@/lib/utils';
import { SHADE_CARD_STATUS_COLORS, MAKING_STATUS_COLORS,
         type ShadeCardStatus, type MakingStatus } from '@/lib/constants/shadeCards';

type MatchedCard = {
  id:                string;
  party:             string;
  product_name:      string;
  pm_code:           string | null;
  shade_card_number: string | null;
  status:            ShadeCardStatus;
  making_status:     MakingStatus;
  approval_date:     string | null;
  updated_at:        string;
};

type Response = {
  cards: MatchedCard[];
  basis: 'pm_code' | 'party_product' | 'none';
};

type Props = {
  pmCode:  string | null;
  party:   string;
  product: string | null;
};

export default function JobShadeCardPanel({ pmCode, party, product }: Props) {
  const params = new URLSearchParams();
  if (pmCode)  params.set('pm_code', pmCode);
  if (party)   params.set('party', party);
  if (product) params.set('product', product);

  const { data, isLoading } = useQuery<Response>({
    queryKey: ['job-shade-card', pmCode, party, product],
    queryFn: async () => {
      const res = await fetch(`/api/shade-cards/for-job?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load shade card');
      return res.json();
    },
    // A job's identifying fields rarely change mid-session, and this panel is
    // reference material rather than live state.
    staleTime: 60_000,
  });

  if (isLoading) {
    return <div className="glass rounded-xl p-4 h-24 animate-pulse" aria-hidden="true" />;
  }

  const cards = data?.cards ?? [];

  return (
    <div className="glass rounded-xl p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--glass-ink)]">
          <Palette className="w-4 h-4" aria-hidden="true" />
          Shade card
        </h3>
        <Link
          href="/admin/shade-cards"
          className="inline-flex items-center gap-1 text-xs font-medium text-[var(--glass-muted)] hover:text-[var(--glass-ink)] transition-colors"
        >
          Open register
          <ExternalLink className="w-3 h-3" aria-hidden="true" />
        </Link>
      </div>

      {cards.length === 0 ? (
        <p className="text-sm text-[var(--glass-muted)]">
          No shade card found for this job.
          {!pmCode && ' This job has no PM code, so only a party + product name match was possible.'}
        </p>
      ) : (
        <>
          <ul className="space-y-2">
            {cards.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-[var(--glass-ink)]">
                  {c.shade_card_number ? `#${c.shade_card_number}` : c.product_name}
                </span>
                <span className={cn('px-2 py-0.5 rounded-md text-xs font-medium',
                  SHADE_CARD_STATUS_COLORS[c.status]?.bg,
                  SHADE_CARD_STATUS_COLORS[c.status]?.text,
                  SHADE_CARD_STATUS_COLORS[c.status]?.border)}>
                  {c.status}
                </span>
                <span className={cn('px-2 py-0.5 rounded-md text-xs font-medium',
                  MAKING_STATUS_COLORS[c.making_status]?.bg,
                  MAKING_STATUS_COLORS[c.making_status]?.text,
                  MAKING_STATUS_COLORS[c.making_status]?.border)}>
                  {c.making_status}
                </span>
                {c.approval_date && (
                  <span className="text-xs text-[var(--glass-muted)] font-mono">
                    approved {formatNumericDate(c.approval_date)}
                  </span>
                )}
              </li>
            ))}
          </ul>

          {/* The fallback rule can match a similarly-named product, so say so
              rather than presenting a loose match as a certain one. */}
          {data?.basis === 'party_product' && (
            <p className="text-[11px] text-[var(--glass-muted)] mt-2.5 pt-2.5 border-t border-black/[0.06]">
              Matched on party and product name — this job has no PM code, so the
              match may not be exact.
            </p>
          )}
        </>
      )}
    </div>
  );
}
