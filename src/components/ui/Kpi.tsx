// src/components/ui/Kpi.tsx
// One figure in a summary strip ("optional summary strip" in DESIGN.md §4):
// label, mono number, and a one-line note under it that turns green or amber
// when it says something good or bad. Put several in one white card; each
// after the first draws its own divider.
//
// Pass onClick and the figure becomes a filter button: `active` marks the
// one applied (a Press Green bar along the bottom, aria-pressed).
//
// Used by: ReportsView (Month at a glance), ShadeCardsManager (filters).

import { cn } from '@/lib/utils';

export type KpiDelta = { text: string; tone: 'good' | 'bad' | 'muted' };

type Props = {
  label:    string;
  value:    string;
  delta:    KpiDelta | null | undefined;
  loading:  boolean;
  active?:  boolean;
  onClick?: () => void;
};

export function Kpi({ label, value, delta, loading, active, onClick }: Props) {
  const body = (
    <>
      <span className={cn('text-[13px]', active ? 'font-semibold text-brand-ink' : 'text-brand-muted')}>{label}</span>
      <span className="font-mono text-[26px] font-semibold leading-8 tracking-[-0.02em] text-brand-ink">{loading ? '—' : value}</span>
      <span className={cn('text-xs', delta?.tone === 'good' ? 'text-brand-success' : delta?.tone === 'bad' ? 'text-brand-warning' : 'text-brand-muted')}>
        {loading ? ' ' : delta?.text}
      </span>
    </>
  );
  const base = 'flex min-w-[180px] flex-1 flex-col gap-1 px-5 py-4 [&+&]:border-l [&+&]:border-brand-line-soft';

  if (!onClick) return <div className={base}>{body}</div>;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        base,
        'text-left transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[rgba(16,85,63,0.18)]',
        active ? 'bg-brand-surface-hover shadow-[inset_0_-3px_0_#10553F]' : 'hover:bg-[#F5F9F7]',
      )}
    >
      {body}
    </button>
  );
}
