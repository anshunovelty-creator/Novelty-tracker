// src/app/admin/shade-cards/[id]/page.tsx
// One shade card: its fields, its approval trail and its revision lineage.
//
// A server component reading Supabase directly, like the other admin detail
// views — there is nothing interactive here. Editing, revising and status
// changes all happen from the register, so this page stays a record rather
// than a second place to change things.
//
// It exists mainly for the trail: 5,975 status-history rows came across in
// the migration and this is where they are readable.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { cn, formatAdminDate, formatNumericDate } from '@/lib/utils';
import {
  SHADE_CARD_STATUS_COLORS,
  MAKING_STATUS_COLORS,
} from '@/lib/constants/shadeCards';
import type { ShadeCard, ShadeCardStatusHistoryEntry } from '@/lib/types';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Shade Card',
  robots: { index: false, follow: false },
};

/** One label/value pair in the details grid. */
function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-[var(--glass-muted)]">{label}</dt>
      <dd className="text-sm text-[var(--glass-ink)] mt-0.5 break-words">{children}</dd>
    </div>
  );
}

export default async function ShadeCardDetailPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: card } = await supabase
    .from('shade_cards').select('*').eq('id', id).maybeSingle<ShadeCard>();

  if (!card) notFound();

  const { data: history } = await supabase
    .from('shade_card_status_history')
    .select('*')
    .eq('shade_card_id', id)
    .order('changed_at', { ascending: false })
    .returns<ShadeCardStatusHistoryEntry[]>();

  // One hop in each direction through the lineage, which is all the imported
  // data ever needs (max version is 2) and all a reader can follow at once.
  const { data: newer } = await supabase
    .from('shade_cards').select('id, version').eq('supersedes_id', id).maybeSingle();

  const trail = history ?? [];

  return (
    <div className="space-y-4">
      <Link
        href="/admin/shade-cards"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--glass-muted)] hover:text-[var(--glass-ink)] transition-colors"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        All shade cards
      </Link>

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold text-[var(--glass-ink)]">{card.party}</h1>
        <span className={cn('px-2 py-0.5 rounded-md text-xs font-medium',
          SHADE_CARD_STATUS_COLORS[card.status]?.bg,
          SHADE_CARD_STATUS_COLORS[card.status]?.text,
          SHADE_CARD_STATUS_COLORS[card.status]?.border)}>
          {card.status}
        </span>
        <span className={cn('px-2 py-0.5 rounded-md text-xs font-medium',
          MAKING_STATUS_COLORS[card.making_status]?.bg,
          MAKING_STATUS_COLORS[card.making_status]?.text,
          MAKING_STATUS_COLORS[card.making_status]?.border)}>
          {card.making_status}
        </span>
        {!card.is_current && (
          <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
            Superseded
          </span>
        )}
      </div>
      <p className="text-sm text-[var(--glass-muted)] -mt-2">{card.product_name}</p>

      {/* ── lineage notice ───────────────────────────────────── */}
      {(newer || card.supersedes_id) && (
        <div className="glass rounded-xl p-4 text-sm text-[var(--glass-ink)] space-y-1">
          {card.supersedes_id && (
            <p>
              Version {card.version}, replacing{' '}
              <Link href={`/admin/shade-cards/${card.supersedes_id}`}
                    className="font-medium underline underline-offset-2">
                the previous version
              </Link>.
            </p>
          )}
          {newer && (
            <p>
              Replaced by{' '}
              <Link href={`/admin/shade-cards/${newer.id}`}
                    className="font-medium underline underline-offset-2">
                version {newer.version}
              </Link>.
            </p>
          )}
        </div>
      )}

      {/* ── details ──────────────────────────────────────────── */}
      <div className="glass rounded-xl p-5">
        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4">
          <Detail label="Shade card #">{card.shade_card_number ?? '—'}</Detail>
          <Detail label="PM code">{card.pm_code ?? '—'}</Detail>
          <Detail label="Docket #">{card.docket_number ?? '—'}</Detail>
          <Detail label="Version">{card.version}</Detail>
          <Detail label="Prepared">{formatNumericDate(card.prepared_date)}</Detail>
          <Detail label="Sent to party">{formatNumericDate(card.sent_to_party_date)}</Detail>
          <Detail label="Received back">{formatNumericDate(card.received_back_date)}</Detail>
          <Detail label="Approved">{formatNumericDate(card.approval_date)}</Detail>
        </dl>

        {(card.qnap_path || card.notes) && (
          <dl className="grid grid-cols-1 gap-4 mt-5 pt-5 border-t border-black/[0.06]">
            {card.qnap_path && (
              // Reference text, never a link: the app does not resolve these
              // paths and a dead hyperlink would imply it does.
              <Detail label="File location">
                <span className="font-mono text-xs">{card.qnap_path}</span>
              </Detail>
            )}
            {card.notes && <Detail label="Notes">{card.notes}</Detail>}
          </dl>
        )}

        <p className="text-xs text-[var(--glass-muted)] mt-5 pt-5 border-t border-black/[0.06]">
          Added by {card.created_by_name ?? 'unknown'} · {formatAdminDate(card.created_at)}
          {' — '}last updated by {card.updated_by_name ?? 'unknown'} · {formatAdminDate(card.updated_at)}
        </p>
      </div>

      {/* ── approval trail ───────────────────────────────────── */}
      <div className="glass rounded-xl p-5">
        <h2 className="text-sm font-semibold text-[var(--glass-ink)] mb-3">Approval trail</h2>

        {trail.length === 0 ? (
          <p className="text-sm text-[var(--glass-muted)]">No status changes recorded.</p>
        ) : (
          <ol className="space-y-3">
            {trail.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono text-xs text-[var(--glass-muted)] w-40 shrink-0">
                  {formatAdminDate(h.changed_at)}
                </span>
                {h.old_status ? (
                  <>
                    <span className="text-[var(--glass-muted)]">{h.old_status}</span>
                    <span className="text-[var(--glass-muted)]" aria-label="changed to">→</span>
                  </>
                ) : (
                  <span className="text-[var(--glass-muted)]">created as</span>
                )}
                <span className={cn('px-2 py-0.5 rounded-md text-xs font-medium',
                  SHADE_CARD_STATUS_COLORS[h.new_status]?.bg,
                  SHADE_CARD_STATUS_COLORS[h.new_status]?.text,
                  SHADE_CARD_STATUS_COLORS[h.new_status]?.border)}>
                  {h.new_status}
                </span>
                <span className="text-xs text-[var(--glass-muted)]">
                  {h.changed_by_name ?? 'unknown'}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
