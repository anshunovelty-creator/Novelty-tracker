'use client';
// src/components/admin/ShadeCardsManager.tsx
// The shade card register: every colour-approval card sent to a party,
// searchable by party, PM code, product, shade card # or docket #.
//
// Read-only for most departments; Prepress, QC and Admin add and correct
// records — see canDeptManageShadeCards. Deleting is admin-only and is the
// one action gated separately, matching the tracker this replaces.
//
// Paged on the server rather than filtered in the browser: there are ~3,000
// cards, and shipping them all to sort a table would be the single largest
// response in the admin panel.

import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Search, Plus, Pencil, Trash2, GitBranch, ChevronLeft, ChevronRight,
         ListFilter } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, formatAdminDate, formatNumericDate } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { csvDate, csvTimestamp, type CsvColumn } from '@/lib/export/csv';
import {
  SHADE_CARD_STATUSES,
  MAKING_STATUSES,
  SHADE_CARD_STATUS_COLORS,
  MAKING_STATUS_COLORS,
  SHADE_CARD_SEARCH_FIELDS,
  type ShadeCardStatus,
  type MakingStatus,
} from '@/lib/constants/shadeCards';
import type { ShadeCard } from '@/lib/types';
import type { ShadeCardSummary } from '@/app/api/shade-cards/summary/route';
import AddShadeCardModal, { type ShadeCardModalMode } from './AddShadeCardModal';
import CsvExportButton from './CsvExportButton';
import { SkeletonRows } from '@/components/ui/Skeleton';

const COLUMNS = [
  'Party', 'Product', 'Shade #', 'PM Code', 'Prepared', 'Approval',
  'Status', 'Made', 'Last updated', 'Actions',
] as const;

type ListResponse = {
  cards:    ShadeCard[];
  total:    number;
  page:     number;
  pageSize: number;
};

const CSV_COLUMNS: CsvColumn<ShadeCard>[] = [
  { header: 'Party',         value: (c) => c.party },
  { header: 'Product',       value: (c) => c.product_name },
  { header: 'Shade Card #',  value: (c) => c.shade_card_number ?? '' },
  { header: 'PM Code',       value: (c) => c.pm_code ?? '' },
  { header: 'Docket #',      value: (c) => c.docket_number ?? '' },
  { header: 'Status',        value: (c) => c.status },
  { header: 'Made',          value: (c) => c.making_status },
  { header: 'Prepared',      value: (c) => csvDate(c.prepared_date) },
  { header: 'Approved',      value: (c) => csvDate(c.approval_date) },
  { header: 'Sent to party', value: (c) => csvDate(c.sent_to_party_date) },
  { header: 'Received back', value: (c) => csvDate(c.received_back_date) },
  { header: 'Version',       value: (c) => String(c.version) },
  { header: 'Notes',         value: (c) => c.notes ?? '' },
  { header: 'Last updated',  value: (c) => csvTimestamp(c.updated_at) },
  { header: 'Updated by',    value: (c) => c.updated_by_name ?? '' },
];

function Chip({ label, cfg }: { label: string; cfg: { bg: string; text: string; border?: string } }) {
  return (
    <span className={cn('inline-block px-2 py-0.5 rounded-md text-xs font-medium whitespace-nowrap',
      cfg.bg, cfg.text, cfg.border)}>
      {label}
    </span>
  );
}

/**
 * One KPI tile. Same vocabulary as DashboardSummaryCard — glass panel, muted
 * micro-label, big mono number, filter glyph and hover lift — with one
 * addition: these tiles drive the filter directly rather than firing a
 * one-shot event, so the applied one has to say it is applied. Without that
 * ring, clicking "Approved" changes the table with nothing left on screen
 * explaining why.
 */
function KpiTile({
  label, value, tone = 'text-[var(--glass-ink)]', sub, active = false, onClick, action,
}: {
  label:   string;
  /** Undefined while the summary loads — renders as an em dash, not a zero,
   *  because "0 approved" is a claim and a loading tile is not. */
  value:   number | undefined;
  tone?:   string;
  sub?:    string;
  active?: boolean;
  /** Absent when the number maps onto no filter this table can apply. Such a
   *  tile renders as a plain panel — the dashboard's summary card draws the
   *  same line, because a tile that looks clickable promises a drill-down. */
  onClick?: () => void;
  action?:  string;
}) {
  // Flex column with the caption pushed to the bottom, so a tile that carries
  // one still lines its number up with the tiles that don't — four numbers
  // meant to be compared have to share a baseline.
  const base = 'glass rounded-xl px-4 py-3 text-left relative flex flex-col';

  const body = (
    <>
      <p className="text-xs text-[var(--glass-muted)] font-medium mb-0.5">{label}</p>
      <p className={cn('text-2xl font-semibold font-mono tabular-nums', tone)}>
        {value?.toLocaleString('en-IN') ?? '—'}
      </p>
      {sub && <p className="text-[11px] text-[var(--glass-muted)] mt-auto pt-1">{sub}</p>}
    </>
  );

  if (!onClick) {
    return <div className={base}>{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`${label}: ${value ?? 'loading'}. ${action}`}
      className={cn(
        'group', base,
        'transition-[background-color,box-shadow,transform] duration-150',
        'hover:bg-white/10 hover:-translate-y-px',
        'hover:shadow-[0_4px_14px_rgba(12,42,32,0.10)]',
        'active:translate-y-0 motion-reduce:hover:translate-y-0',
        active && 'ring-2 ring-emerald-400/70 bg-white/10',
      )}
    >
      <ListFilter
        className={cn(
          'absolute right-3 top-3 h-3.5 w-3.5 text-[var(--glass-muted)] transition-opacity',
          active ? 'opacity-100' : 'opacity-60 group-hover:opacity-100',
        )}
        aria-hidden="true"
      />
      {body}
    </button>
  );
}

type Props = {
  canManage: boolean;
  canDelete: boolean;
  /** Lets the page hand down the height constraint that makes the table, and
   *  not the document, the thing that scrolls. */
  className?: string;
};

export default function ShadeCardsManager({ canManage, canDelete, className }: Props) {
  const queryClient = useQueryClient();

  const [search,  setSearch]  = useState('');
  const [field,   setField]   = useState('all');
  const [status,  setStatus]  = useState('');
  const [making,  setMaking]  = useState('');
  const [page,    setPage]    = useState(1);
  // Set only by the "Added last 7 days" tile — there is no dropdown for it,
  // because the window it filters on is the one that tile counted rather than
  // anything a user would pick by hand.
  const [createdFrom, setCreatedFrom] = useState('');

  const [modal,      setModal]      = useState<{ mode: ShadeCardModalMode; card?: ShadeCard } | null>(null);
  const [confirmId,  setConfirmId]  = useState<string | null>(null);
  const [busyId,     setBusyId]     = useState<string | null>(null);

  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (search && field !== 'all') params.set('field', field);
  if (status) params.set('status', status);
  if (making) params.set('making', making);
  if (createdFrom) params.set('created_from', createdFrom);
  params.set('page', String(page));

  const { data, isLoading } = useQuery<ListResponse>({
    queryKey: ['shade-cards', search, field, status, making, createdFrom, page],
    queryFn: async () => {
      const res = await fetch(`/api/shade-cards?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load shade cards');
      return res.json();
    },
    // Keeps the previous page on screen while the next one loads, so paging
    // doesn't blank the table on every click.
    placeholderData: keepPreviousData,
  });

  // Register-wide counts for the KPI tiles. Keyed under 'shade-cards' so the
  // three existing invalidateQueries({ queryKey: ['shade-cards'] }) calls
  // refresh the tiles too — a status change has to move two numbers at once,
  // and a separate key would have been a fourth place to remember that.
  const { data: summary } = useQuery<ShadeCardSummary>({
    queryKey: ['shade-cards', 'summary'],
    queryFn: async () => {
      const res = await fetch('/api/shade-cards/summary');
      if (!res.ok) throw new Error('Failed to load shade card summary');
      return res.json();
    },
  });

  const cards = data?.cards ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 25;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['shade-cards'] });
    setModal(null);
  }

  /** Any filter change returns to page 1 — staying on page 7 of a result set
   *  that now has two pages shows an empty table and reads as a bug. */
  function changeFilter(fn: () => void) {
    fn();
    setPage(1);
  }

  async function patchCard(card: ShadeCard, body: Record<string, unknown>, okMsg: string) {
    setBusyId(card.id);
    try {
      const res = await fetch(`/api/shade-cards/${card.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? 'Update failed');
        return;
      }
      toast.success(okMsg);
      queryClient.invalidateQueries({ queryKey: ['shade-cards'] });
    } catch {
      toast.error('Network error');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(card: ShadeCard) {
    setBusyId(card.id);
    try {
      const res = await fetch(`/api/shade-cards/${card.id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? 'Delete failed');
        return;
      }
      toast.success('Shade card deleted');
      setConfirmId(null);
      queryClient.invalidateQueries({ queryKey: ['shade-cards'] });
    } catch {
      toast.error('Network error');
    } finally {
      setBusyId(null);
    }
  }

  const hasFilters = Boolean(search || status || making || createdFrom);

  /** Clears every filter at once. The recency filter has no dropdown of its
   *  own, so "Total cards" is the only control that can lift it — it must not
   *  be missed here or the list would stay narrowed with nothing saying why. */
  function clearFilters() {
    setSearch('');
    setStatus('');
    setMaking('');
    setCreatedFrom('');
  }

  return (
    // Flex column rather than space-y so the table can be told to absorb
    // whatever height is left over once the controls and paging have taken
    // theirs — see the page for where that height comes from.
    <div className={cn('flex flex-col gap-3', className)}>
      {/* ── KPIs ─────────────────────────────────────────────── */}
      {/* Every tile is a filter shortcut. Each one applies its own filter and
          clears the others, so the tiles and the table never disagree about
          what is on screen; clicking the applied tile lifts it again, which is
          the only way back for the recency filter since it has no dropdown. */}
      <div className="shrink-0 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile
          label="Total cards"
          value={summary?.total}
          active={!hasFilters}
          onClick={() => changeFilter(clearFilters)}
          action="Clear all filters"
        />
        <KpiTile
          label="Approved"
          value={summary?.approved}
          tone="text-emerald-600"
          active={status === 'Approved'}
          onClick={() => changeFilter(() => {
            const on = status === 'Approved';
            clearFilters();
            if (!on) setStatus('Approved');
          })}
          action="Show approved cards"
        />
        <KpiTile
          label="Pending approval"
          value={summary?.pending_approval}
          tone="text-amber-600"
          active={status === 'Pending Approval'}
          onClick={() => changeFilter(() => {
            const on = status === 'Pending Approval';
            clearFilters();
            if (!on) setStatus('Pending Approval');
          })}
          action="Show cards waiting on the party"
        />
        {/* Filters on the very cutoff the summary counted from, so the list it
            opens holds exactly the cards this number counted. */}
        <KpiTile
          label="Added last 7 days"
          value={summary?.added_last_7_days}
          tone="text-sky-600"
          sub="new entries"
          active={Boolean(createdFrom)}
          onClick={() => changeFilter(() => {
            const on = Boolean(createdFrom);
            clearFilters();
            if (!on && summary) setCreatedFrom(summary.added_since);
          })}
          action="Show the cards added in the last 7 days"
        />
      </div>

      {/* ── controls ─────────────────────────────────────────── */}
      <div className="shrink-0 flex flex-col sm:flex-row sm:items-center gap-2">
        <label htmlFor="sc-search-field" className="sr-only">Search field</label>
        <select
          id="sc-search-field"
          value={field}
          onChange={(e) => changeFilter(() => setField(e.target.value))}
          title="Narrow the search to one field"
          className={cn(
            'min-h-11 px-3 rounded-lg text-sm shrink-0',
            'bg-[var(--field-bg)] border border-[var(--field-border)] text-[var(--glass-ink)]',
            'focus:outline-none focus:border-emerald-300/70 transition-all',
          )}
        >
          {SHADE_CARD_SEARCH_FIELDS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>

        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--glass-muted)]"
            aria-hidden="true"
          />
          <label htmlFor="sc-search" className="sr-only">Search shade cards</label>
          <input
            id="sc-search"
            value={search}
            onChange={(e) => changeFilter(() => setSearch(e.target.value))}
            placeholder={SHADE_CARD_SEARCH_FIELDS.find((f) => f.value === field)?.placeholder}
            data-global-search
            className={cn(
              'w-full pl-9 pr-3 py-2 rounded-lg text-sm min-h-11',
              'bg-[var(--field-bg)] border border-[var(--field-border)]',
              'text-[var(--glass-ink)] placeholder:text-[var(--glass-muted)]',
              'focus:outline-none focus:border-emerald-300/70',
            )}
          />
        </div>

        <label htmlFor="sc-filter-status" className="sr-only">Filter by status</label>
        <select
          id="sc-filter-status"
          value={status}
          onChange={(e) => changeFilter(() => setStatus(e.target.value))}
          className="min-h-11 px-3 rounded-lg text-sm bg-[var(--field-bg)] border border-[var(--field-border)] text-[var(--glass-ink)]"
        >
          <option value="">All statuses</option>
          {SHADE_CARD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        <label htmlFor="sc-filter-making" className="sr-only">Filter by whether the card is made</label>
        <select
          id="sc-filter-making"
          value={making}
          onChange={(e) => changeFilter(() => setMaking(e.target.value))}
          className="min-h-11 px-3 rounded-lg text-sm bg-[var(--field-bg)] border border-[var(--field-border)] text-[var(--glass-ink)]"
        >
          <option value="">Made or not</option>
          {MAKING_STATUSES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>

        <CsvExportButton rows={cards} columns={CSV_COLUMNS} filename="shade-cards" />

        {canManage && (
          <Button intent="primary" icon={Plus} onClick={() => setModal({ mode: 'create' })}>
            Add card
          </Button>
        )}
      </div>

      {/* Only while filtered. Unfiltered, this said the same number as the
          Total tile directly above it — and the tiles now carry the headline
          count, so repeating it cost a line of the table's height for nothing.
          Reads off the server total, not the loaded page, which would always
          say 25. */}
      {hasFilters && (
        <p className="shrink-0 text-sm text-[var(--glass-muted)]">
          <strong className="text-[var(--glass-ink)]">{total.toLocaleString('en-IN')}</strong>
          {total === 1 ? ' shade card' : ' shade cards'} matching your filters
        </p>
      )}

      {/* ── desk table ───────────────────────────────────────── */}
      {/* At lg the page caps its own height, so the table takes the remainder
          (flex-1) and scrolls inside it. Below that the page scrolls normally
          and the old 70vh cap is what stops the table running off-screen. */}
      <div className="hidden sm:flex sm:flex-col min-h-0 lg:flex-1 rounded-xl glass overflow-hidden">
        {/* contain:paint is what actually stops the page scrolling. Chrome
            counts this table's overflow toward the ROOT scrollable area even
            though the wrapper scrolls it and the page box clips it — which
            left ~1,000px of empty scrollable space below the fold. Paint
            containment tells the browser nothing inside affects layout
            outside, and the phantom scroll goes away. Safe here because the
            wrapper already clips: no popover inside the table escapes it. */}
        <div className="table-scroll-wrapper [contain:paint] overflow-y-auto max-h-[70vh] lg:max-h-none lg:flex-1 lg:min-h-0">
          {/* Column rules are declared once here rather than on all ten cells.
              Same vocabulary as the Job Separation table: a thin vertical rule
              between columns, and none after the last one. */}
          <table className={cn(
            'w-full min-w-[1100px] border-collapse text-sm',
            '[&_td:not(:last-child)]:border-r [&_td:not(:last-child)]:border-white/8',
            '[&_th:not(:last-child)]:border-r [&_th:not(:last-child)]:border-white/12',
          )}>
            <thead className="sticky top-0 z-10 bg-[var(--glass-bg-strong)] backdrop-blur">
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c} scope="col"
                      className={cn(
                        'px-4 py-1.5 text-left text-[11px] font-semibold text-[var(--glass-muted)]',
                        'uppercase tracking-[0.06em] whitespace-nowrap border-b border-white/12',
                      )}>
                    {c === 'Actions' && !canManage ? '' : c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <SkeletonRows rows={6} cols={COLUMNS.length} />
              ) : cards.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-10 text-center text-sm text-[var(--glass-muted)]">
                    {hasFilters ? 'No shade cards match your filters.' : 'No shade cards yet.'}
                  </td>
                </tr>
              ) : cards.map((c, i) => (
                // Alternating row tint, same as the Job Separation register:
                // ten columns is a long way for the eye to travel, and the
                // banding is what keeps it on one card's row.
                <tr
                  key={c.id}
                  className={cn(
                    'border-b border-white/8 transition-colors',
                    i % 2 === 1 && 'bg-[var(--glass-bg)]',
                    'hover:bg-black/[0.03]',
                  )}
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/shade-cards/${c.id}`}
                      className="font-medium text-[var(--glass-ink)] hover:underline underline-offset-2"
                    >
                      {c.party}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[var(--glass-ink)]">{c.product_name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-[var(--glass-muted)] whitespace-nowrap">{c.shade_card_number ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-[var(--glass-muted)] whitespace-nowrap">{c.pm_code ?? '—'}</td>
                  {/* A date reads as one token or not at all — the uppercase
                      column headings are wide enough to squeeze these cells
                      into wrapping without it. */}
                  <td className="px-4 py-3 font-mono text-xs text-[var(--glass-muted)] whitespace-nowrap">{formatNumericDate(c.prepared_date)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-[var(--glass-muted)] whitespace-nowrap">{formatNumericDate(c.approval_date)}</td>
                  <td className="px-4 py-3">
                    {canManage ? (
                      <>
                        <label htmlFor={`st-${c.id}`} className="sr-only">Approval status for {c.product_name}</label>
                        <select
                          id={`st-${c.id}`}
                          value={c.status}
                          disabled={busyId === c.id}
                          onChange={(e) => patchCard(c, { action: 'status', status: e.target.value }, 'Status updated')}
                          className={cn(
                            'px-2 py-1 rounded-md text-xs font-medium border cursor-pointer disabled:opacity-50',
                            SHADE_CARD_STATUS_COLORS[c.status]?.bg,
                            SHADE_CARD_STATUS_COLORS[c.status]?.text,
                          )}
                        >
                          {/* A retired status still renders if the row carries
                              one, so the value never silently disappears. */}
                          {(SHADE_CARD_STATUSES as ShadeCardStatus[]).includes(c.status)
                            ? null
                            : <option value={c.status}>{c.status}</option>}
                          {SHADE_CARD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </>
                    ) : (
                      <Chip label={c.status} cfg={SHADE_CARD_STATUS_COLORS[c.status]} />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {canManage && c.making_status !== 'Already Made' ? (
                      <>
                        <label htmlFor={`mk-${c.id}`} className="sr-only">Whether the card for {c.product_name} is made</label>
                        <select
                          id={`mk-${c.id}`}
                          value={c.making_status}
                          disabled={busyId === c.id}
                          onChange={(e) => patchCard(c, { action: 'making', making_status: e.target.value }, 'Marked as made')}
                          className={cn(
                            'px-2 py-1 rounded-md text-xs font-medium border cursor-pointer disabled:opacity-50',
                            MAKING_STATUS_COLORS[c.making_status]?.bg,
                            MAKING_STATUS_COLORS[c.making_status]?.text,
                          )}
                        >
                          {MAKING_STATUSES.map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </>
                    ) : (
                      <Chip label={c.making_status} cfg={MAKING_STATUS_COLORS[c.making_status]} />
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--glass-muted)] whitespace-nowrap">
                    {c.updated_by_name ?? 'unknown'}
                    <span className="block">{formatAdminDate(c.updated_at)}</span>
                  </td>
                  <td className="px-4 py-3">
                    {canManage && (
                      <div className="flex items-center gap-1.5 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setModal({ mode: 'edit', card: c })}
                          title="Edit this version"
                          aria-label={`Edit ${c.product_name}`}
                          className="min-h-11 px-2 text-[var(--glass-muted)] hover:text-[var(--glass-ink)] transition-colors"
                        >
                          <Pencil className="w-4 h-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setModal({ mode: 'revise', card: c })}
                          title="Supersede with a new version"
                          aria-label={`Revise ${c.product_name}`}
                          className="min-h-11 px-2 text-[var(--glass-muted)] hover:text-[var(--glass-ink)] transition-colors"
                        >
                          <GitBranch className="w-4 h-4" aria-hidden="true" />
                        </button>
                        {canDelete && (
                          confirmId === c.id ? (
                            <span className="flex items-center gap-1.5">
                              <button
                                type="button"
                                disabled={busyId === c.id}
                                onClick={() => handleDelete(c)}
                                className="min-h-11 px-2 text-xs font-semibold text-red-600 hover:text-red-700 disabled:opacity-40"
                              >
                                Delete
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmId(null)}
                                className="min-h-11 px-2 text-xs font-medium text-[var(--glass-muted)] hover:text-[var(--glass-ink)]"
                              >
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmId(c.id)}
                              title="Delete this shade card"
                              aria-label={`Delete ${c.product_name}`}
                              className="min-h-11 px-2 text-[var(--glass-muted)] hover:text-red-600 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" aria-hidden="true" />
                            </button>
                          )
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── mobile cards ─────────────────────────────────────── */}
      <ul className="sm:hidden space-y-3">
        {isLoading ? (
          <li className="space-y-2" aria-hidden="true">
            {[0, 1, 2].map((i) => <div key={i} className="h-28 rounded-xl bg-black/[0.04]" />)}
          </li>
        ) : cards.length === 0 ? (
          <li className="glass rounded-xl p-6 text-center text-sm text-[var(--glass-muted)]">
            {hasFilters ? 'No shade cards match your filters.' : 'No shade cards yet.'}
          </li>
        ) : cards.map((c) => (
          <li key={c.id} className="glass rounded-xl p-4">
            <div className="flex items-start justify-between gap-3">
              <Link href={`/admin/shade-cards/${c.id}`} className="min-w-0">
                <p className="font-medium text-[var(--glass-ink)] break-words underline underline-offset-2">{c.party}</p>
                <p className="text-sm text-[var(--glass-muted)] break-words">{c.product_name}</p>
              </Link>
              <Chip label={c.status} cfg={SHADE_CARD_STATUS_COLORS[c.status]} />
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-3 pt-3 border-t border-black/[0.06] text-xs">
              <div><dt className="inline text-[var(--glass-muted)]">Shade #: </dt>
                   <dd className="inline font-mono text-[var(--glass-ink)]">{c.shade_card_number ?? '—'}</dd></div>
              <div><dt className="inline text-[var(--glass-muted)]">PM: </dt>
                   <dd className="inline font-mono text-[var(--glass-ink)]">{c.pm_code ?? '—'}</dd></div>
              <div><dt className="inline text-[var(--glass-muted)]">Prepared: </dt>
                   <dd className="inline font-mono text-[var(--glass-ink)]">{formatNumericDate(c.prepared_date)}</dd></div>
              <div><dt className="inline text-[var(--glass-muted)]">Approved: </dt>
                   <dd className="inline font-mono text-[var(--glass-ink)]">{formatNumericDate(c.approval_date)}</dd></div>
            </dl>

            <div className="flex flex-wrap items-center gap-2 mt-3">
              <Chip label={c.making_status} cfg={MAKING_STATUS_COLORS[c.making_status]} />
              <span className="text-xs text-[var(--glass-muted)]">
                {formatAdminDate(c.updated_at)} · {c.updated_by_name ?? 'unknown'}
              </span>
            </div>

            {canManage && (
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-black/[0.06]">
                <Button size="sm" intent="ghost" icon={Pencil}
                        onClick={() => setModal({ mode: 'edit', card: c })}>Edit</Button>
                <Button size="sm" intent="ghost" icon={GitBranch}
                        onClick={() => setModal({ mode: 'revise', card: c })}>Revise</Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* ── paging ───────────────────────────────────────────── */}
      {total > pageSize && (
        <div className="shrink-0 flex items-center justify-between gap-3 pt-1">
          <p className="text-xs text-[var(--glass-muted)]">
            Page {page} of {lastPage}
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" intent="ghost" icon={ChevronLeft}
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Previous
            </Button>
            <Button size="sm" intent="ghost" icon={ChevronRight}
                    disabled={page >= lastPage}
                    onClick={() => setPage((p) => Math.min(lastPage, p + 1))}>
              Next
            </Button>
          </div>
        </div>
      )}

      {modal && (
        <AddShadeCardModal
          mode={modal.mode}
          card={modal.card}
          onClose={() => setModal(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
