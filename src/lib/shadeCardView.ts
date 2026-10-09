// src/lib/shadeCardView.ts
// ============================================================
// The register's "With party" column. A card sent for approval
// and not yet answered is the party's move; once it has sat with them longer
// than WITH_PARTY_LATE_DAYS the age turns red, so Prepress knows whom to chase.
// ============================================================

import type { ShadeCard } from '@/lib/types';

export const WITH_PARTY_LATE_DAYS = 5;

/** Whole days a pending card has been with the party, or null when it isn't waiting on them. */
export function daysWithParty(card: Pick<ShadeCard, 'status' | 'sent_to_party_date'>, now: Date = new Date()): number | null {
  if (card.status !== 'Pending Approval' || !card.sent_to_party_date) return null;
  const sent = new Date(`${card.sent_to_party_date.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(sent.getTime())) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((today.getTime() - sent.getTime()) / 86_400_000));
}

export function withPartyLabel(days: number): string {
  return days === 0 ? 'today' : days === 1 ? '1 day' : `${days} days`;
}
