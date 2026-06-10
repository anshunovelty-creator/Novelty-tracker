'use client';
// src/components/track/DeliveryCountdown.tsx
// Client component so countdown stays accurate without a page reload.

import { getDeliveryCountdown } from '@/lib/utils';
import { cn } from '@/lib/utils';

type Props = {
  deliveryDate: string | null;
};

export default function DeliveryCountdown({ deliveryDate }: Props) {
  const countdown = getDeliveryCountdown(deliveryDate);

  const colorClass = {
    green: 'text-green-700',
    amber: 'text-amber-700 font-semibold',
    red:   'text-red-700 font-semibold',
    muted: 'text-brand-muted',
  }[countdown.color];

  return (
    <p className={cn('text-sm mt-2', colorClass)}>
      {countdown.label}
    </p>
  );
}
