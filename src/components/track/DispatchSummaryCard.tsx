'use client';
// src/components/track/DispatchSummaryCard.tsx

import { formatQty } from '@/lib/utils';

type Props = {
  total:      number | null;
  dispatched: number;
  remaining:  number | null;
};

export default function DispatchSummaryCard({ total, dispatched, remaining }: Props) {
  const pct = total ? Math.round((dispatched / total) * 100) : 0;

  return (
    <div className="bg-white border border-brand-border rounded-2xl p-5">
      <h3 className="text-sm font-semibold text-brand-accent mb-4">Dispatch Summary</h3>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatBox label="Total Ordered" value={formatQty(total)}        color="text-brand-accent" />
        <StatBox label="Dispatched"    value={formatQty(dispatched)}   color="text-green-700" />
        <StatBox label="Remaining"     value={formatQty(remaining)}    color="text-amber-700" />
      </div>

      {/* Fill bar */}
      <div className="h-2 bg-brand-bg rounded-full">
        <div
          className="h-full bg-green-500 rounded-full transition-all duration-500"
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <p className="text-xs text-brand-muted mt-1.5 text-right">{pct}% dispatched</p>
    </div>
  );
}

function StatBox({
  label, value, color,
}: {
  label: string; value: string; color: string;
}) {
  return (
    <div className="bg-brand-bg rounded-xl p-3 text-center">
      <p className="text-xs text-brand-muted mb-1">{label}</p>
      <p className={`text-base font-semibold font-mono ${color}`}>{value}</p>
    </div>
  );
}
