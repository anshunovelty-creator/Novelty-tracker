'use client';
// src/components/track/DeliveryCountdown.tsx
// Client component so countdown stays accurate without a page reload.

import { differenceInDays } from 'date-fns';
import { getDeliveryCountdown } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { CountUp } from '@/components/motion/CountUp';

type Props = {
  deliveryDate: string | null;
};

export default function DeliveryCountdown({ deliveryDate }: Props) {
  const countdown = getDeliveryCountdown(deliveryDate);

  const colorClass = {
    green: 'text-emerald-200',
    amber: 'text-amber-200 font-semibold',
    red:   'text-red-200 font-semibold',
    muted: 'text-[var(--glass-muted)]',
  }[countdown.color];

  // Compute diff so we can animate the numeric portion via CountUp.
  // The label/color still comes from getDeliveryCountdown (single source of truth).
  let labelNode: React.ReactNode = countdown.label;

  if (deliveryDate) {
    const target = new Date(deliveryDate);
    const today  = new Date();
    today.setHours(0, 0, 0, 0);
    target.setHours(0, 0, 0, 0);
    const diff = differenceInDays(target, today);

    if (diff > 2) {
      labelNode = <>Delivery in <CountUp value={diff} /> days</>;
    } else if (diff === 2) {
      labelNode = <>Due in <CountUp value={2} /> days</>;
    } else if (diff < 0) {
      const overdue = Math.abs(diff);
      labelNode = <>Overdue by <CountUp value={overdue} /> day{overdue > 1 ? 's' : ''}</>;
    }
    // diff === 1 → "Due tomorrow", diff === 0 → "Delivery due today" — no number, keep label as-is
  }

  return (
    <p className={cn('text-sm mt-2', colorClass)}>
      {labelNode}
    </p>
  );
}
