// src/lib/stockViews.ts
// Label stock's kind tabs and its totals card. Pure functions over the list
// the page already holds, so neither costs an extra request.
//
// "Usable now" is Extra + Manual: labels nobody is owed. Remaining is the
// balance of a partly dispatched order — it's on the shelf but promised.
// "Not moved in 6 months" is live stock added more than six calendar months
// ago: worth a call to the party before it's written off.

import type { LabelStock, StockKind } from '@/lib/types';
import { istToday } from '@/lib/jobViews';

export type StockTab = 'shelf' | StockKind | 'history';

/** Entries a tab shows. `stock` may include dispatched rows (history view). */
export function stockForTab(stock: LabelStock[], tab: StockTab): LabelStock[] {
  if (tab === 'history') return stock.filter((s) => s.is_dispatched);
  const live = stock.filter((s) => !s.is_dispatched);
  return tab === 'shelf' ? live : live.filter((s) => s.kind === tab);
}

/** 'YYYY-MM-DD' six calendar months before `today` (clamped to month end). */
export function sixMonthsBefore(today: string): string {
  const y = +today.slice(0, 4);
  const m = +today.slice(5, 7) - 6;            // may go ≤ 0; Date.UTC rolls the year back
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const d = Math.min(+today.slice(8, 10), lastDay);
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
}

export type StockTotals = {
  usableQty:   number; usableCount:   number;
  promisedQty: number; promisedCount: number;
  staleQty:    number; staleCount:    number;
};

export function stockTotals(stock: LabelStock[], now: Date = new Date()): StockTotals {
  const cutoff = sixMonthsBefore(istToday(now));
  const t: StockTotals = {
    usableQty: 0, usableCount: 0, promisedQty: 0, promisedCount: 0, staleQty: 0, staleCount: 0,
  };
  for (const s of stock) {
    if (s.is_dispatched) continue;
    if (s.kind === 'Remaining') { t.promisedQty += s.qty; t.promisedCount += 1; }
    else                        { t.usableQty   += s.qty; t.usableCount   += 1; }
    // created_at is a UTC timestamp; compare the plant's calendar day.
    if (istToday(new Date(s.created_at)) < cutoff) { t.staleQty += s.qty; t.staleCount += 1; }
  }
  return t;
}
