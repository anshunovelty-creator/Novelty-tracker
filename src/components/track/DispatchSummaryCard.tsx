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
    <div className="glass rounded-2xl p-5">
      <h3 className="text-sm font-semibold text-[var(--glass-ink)] mb-4">Dispatch Summary</h3>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatBox label="Total Ordered" value={formatQty(total)}        color="text-[var(--glass-ink)]" />
        <StatBox label="Dispatched"    value={formatQty(dispatched)}   color="text-emerald-200" />
        <StatBox label="Remaining"     value={formatQty(remaining)}    color="text-amber-200" />
      </div>

      {/* Fill bar */}
      <div className="h-2 bg-white/10 rounded-full">
        <div
          className="h-full bg-emerald-400 rounded-full transition-all duration-500"
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <p className="text-xs text-[var(--glass-muted)] mt-1.5 text-right">{pct}% dispatched</p>
    </div>
  );
}

function StatBox({
  label, value, color,
}: {
  label: string; value: string; color: string;
}) {
  return (
    <div className="bg-white/10 rounded-xl p-3 text-center">
      <p className="text-xs text-[var(--glass-muted)] mb-1">{label}</p>
      <p className={`text-base font-semibold font-mono ${color}`}>{value}</p>
    </div>
  );
}
