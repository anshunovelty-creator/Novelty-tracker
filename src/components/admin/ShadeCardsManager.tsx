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

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Search, Plus, Pencil, Trash2, GitBranch, ChevronLeft, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, formatAdminDate, formatNumericDate } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { csvDate, csvTimestamp, type CsvColumn } from '@/lib/export/csv';
import type { SortDir } from '@/lib/sort';
import { SHADE_CARD_STATUSES, MAKING_STATUSES, SHADE_CARD_STATUS_COLORS, MAKING_STATUS_COLORS, SHADE_CARD_SEARCH_FIELDS, type ShadeCardStatus, type MakingStatus, SHADE_CARD_STATUS_DOT, MAKING_STATUS_DOT } from '@/lib/constants/shadeCards';
import { StateChip } from '@/components/ui/StateChip';
import type { ShadeCard } from '@/lib/types';
import { SHADE_TAB_FILTERS, WITH_PARTY_LATE_DAYS, daysWithParty, withPartyLabel, type ShadeTab } from '@/lib/shadeCardView';
import type { ShadeCardSummary } from '@/app/api/shade-cards/summary/route';
import type { ShadeCardModalMode } from './AddShadeCardModal';
import CsvExportButton from './CsvExportButton';
import SortableHeaderLabel from './SortableHeaderLabel';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { SearchClearButton } from '@/components/ui/SearchClearButton';

// Loaded on first open, not with the page — it only renders when open.
const AddShadeCardModal = dynamic(() => import('./AddShadeCardModal'), { ssr: false });

const COLUMNS = [
  'Party', 'Product', 'Shade #', 'PM Code', 'Prepared', 'Approval',
  'Status', 'Made', 'With party', 'Last updated', 'Actions',
] as const;

// Click-to-sort — unlike the other tables here, this list is paged on the
// server (see the file banner above), so sorting has to happen there too:
// a client-side sort would only reorder the 25 rows already on screen, not
// the ~3,000-row register. Every column here now has a matching entry in
// the API's SORTABLE set (src/app/api/shade-cards/route.ts).
type SortField =
  | 'product_name' | 'shade_card_number' | 'pm_code'
  | 'prepared_date' | 'approval_date' | 'status' | 'making_status' | 'updated_at';

const COLUMN_SORT_FIELDS: Partial<Record<typeof COLUMNS[number], SortField>> = {
  'Product':      'product_name',
  'Shade #':      'shade_card_number',
  'PM Code':      'pm_code',
  'Prepared':     'prepared_date',
  'Approval':     'approval_date',
  'Status':       'status',
  'Made':         'making_status',
  'Last updated': 'updated_at',
};

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
  // The tab is the status filter: Waiting on party leads, because the cards
  // sitting with a party are the ones someone has to chase.
  const [tab,     setTab]     = useState<ShadeTab>('waiting');
  const { status, making } = SHADE_TAB_FILTERS[tab];
  const [page,    setPage]    = useState(1);
  const [sort,    setSort]    = useState<SortField>('shade_card_number');
  const [dir,     setDir]     = useState<SortDir>('asc');

  const [modal,      setModal]      = useState<{ mode: ShadeCardModalMode; card?: ShadeCard } | null>(null);
  const [confirmId,  setConfirmId]  = useState<string | null>(null);
  const [busyId,     setBusyId]     = useState<string | null>(null);

  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (search && field !== 'all') params.set('field', field);
  if (status) params.set('status', status);
  if (making) params.set('making', making);
  params.set('page', String(page));
  params.set('sort', sort);
  params.set('dir', dir);

  const { data, isLoading } = useQuery<ListResponse>({
    queryKey: ['shade-cards', search, field, status, making, page, sort, dir],
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

  // Click a header to sort by it; click the same one again to flip direction.
  // A re-sort reorders the whole register, not just this page, so it returns
  // to page 1 the same way a filter change does.
  function handleSort(field: SortField) {
    changeFilter(() => {
      if (field === sort) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      else { setSort(field); setDir('asc'); }
    });
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

  const hasFilters = Boolean(search || tab !== 'all');

  const TABS: { id: ShadeTab; label: string; count: number | undefined }[] = [
    { id: 'waiting',  label: 'Waiting on party', count: summary?.waiting_on_party },
    { id: 'notmade',  label: 'Not made yet',     count: summary?.not_made },
    { id: 'approved', label: 'Approved',         count: summary?.approved },
    { id: 'rejected', label: 'Rejected',         count: summary?.rejected },
    { id: 'all',      label: 'All',              count: summary?.total },
  ];

  return (
    // Flex column rather than space-y so the table can be told to absorb
    // whatever height is left over once the controls and paging have taken
    // theirs — see the page for where that height comes from.
    <div className={cn('flex flex-col gap-3', className)}>
      {/* ── tabs ─────────────────────────────────────────────── */}
      {/* Register-wide counts beside each tab; the tab is the status filter. */}
      <div role="tablist" aria-label="Approval" className="flex shrink-0 gap-1 overflow-x-auto border-b border-brand-border">
        {TABS.map((t) => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => changeFilter(() => setTab(t.id))}
              className={cn(
                '-mb-px flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm transition-colors',
                on ? 'border-brand-primary font-semibold text-brand-ink' : 'border-transparent font-medium text-brand-muted hover:text-brand-ink',
              )}
            >
              {t.label}
              <span className={cn('font-mono text-xs', on ? 'text-brand-ink' : 'text-brand-muted')}>
                {t.count?.toLocaleString('en-IN') ?? '—'}
              </span>
            </button>
          );
        })}
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
              'w-full pl-9 pr-11 py-2 rounded-lg text-sm min-h-11',
              'bg-[var(--field-bg)] border border-[var(--field-border)]',
              'text-[var(--glass-ink)] placeholder:text-[var(--glass-muted)]',
              'focus:outline-none focus:border-emerald-300/70',
            )}
          />
          <SearchClearButton value={search} onClear={() => changeFilter(() => setSearch(''))} />
        </div>

        {/* Every card matching the filters, not just this page's 25. */}
        <CsvExportButton
          columns={CSV_COLUMNS}
          filename="shade-cards"
          count={total}
          fetchRows={async () => {
            const all = new URLSearchParams(params);
            all.delete('page');
            all.set('export', '1');
            const res  = await fetch(`/api/shade-cards?${all.toString()}`);
            const body = await res.json();
            if (!res.ok) throw new Error(body.error ?? 'Export failed. Please try again.');
            return body.cards as ShadeCard[];
          }}
        />

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
                    {c === 'Actions' && !canManage ? '' : COLUMN_SORT_FIELDS[c] ? (
                      <SortableHeaderLabel
                        label={c}
                        active={sort === COLUMN_SORT_FIELDS[c]}
                        dir={dir}
                        onClick={() => handleSort(COLUMN_SORT_FIELDS[c]!)}
                      />
                    ) : c}
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
                        <span className="relative inline-flex items-center">
                        <span aria-hidden="true" className="pointer-events-none absolute left-2 h-2 w-2 rounded-full" style={{ background: SHADE_CARD_STATUS_DOT[c.status] }} />
                        <select
                          id={`st-${c.id}`}
                          value={c.status}
                          disabled={busyId === c.id}
                          onChange={(e) => patchCard(c, { action: 'status', status: e.target.value }, 'Status updated')}
                          className={cn(
                            'pl-6 pr-2 py-1 rounded-md text-xs font-semibold border cursor-pointer disabled:opacity-50',
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
                        </span>
                      </>
                    ) : (
                      <StateChip label={c.status} dot={SHADE_CARD_STATUS_DOT[c.status]} />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {canManage && c.making_status !== 'Already Made' ? (
                      <>
                        <label htmlFor={`mk-${c.id}`} className="sr-only">Whether the card for {c.product_name} is made</label>
                        <span className="relative inline-flex items-center">
                        <span aria-hidden="true" className="pointer-events-none absolute left-2 h-2 w-2 rounded-full" style={{ background: MAKING_STATUS_DOT[c.making_status] }} />
                        <select
                          id={`mk-${c.id}`}
                          value={c.making_status}
                          disabled={busyId === c.id}
                          onChange={(e) => patchCard(c, { action: 'making', making_status: e.target.value }, 'Marked as made')}
                          className={cn(
                            'pl-6 pr-2 py-1 rounded-md text-xs font-semibold border cursor-pointer disabled:opacity-50',
                            MAKING_STATUS_COLORS[c.making_status]?.bg,
                            MAKING_STATUS_COLORS[c.making_status]?.text,
                          )}
                        >
                          {MAKING_STATUSES.map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                        </span>
                      </>
                    ) : (
                      <StateChip label={c.making_status} dot={MAKING_STATUS_DOT[c.making_status]} />
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <WithParty card={c} />
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
              <StateChip label={c.status} dot={SHADE_CARD_STATUS_DOT[c.status]} />
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
              <StateChip label={c.making_status} dot={MAKING_STATUS_DOT[c.making_status]} />
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

/** Days the card has been with the party — red once it's late enough to chase. */
function WithParty({ card }: { card: ShadeCard }) {
  const days = daysWithParty(card);
  if (days === null) return <span className="text-xs text-[var(--glass-muted)]">—</span>;
  const late = days > WITH_PARTY_LATE_DAYS;
  return (
    <span
      className={cn('font-mono text-xs', late ? 'font-semibold text-brand-danger' : 'text-[var(--glass-ink)]')}
      title={`Sent ${formatNumericDate(card.sent_to_party_date)}${late ? ` — over ${WITH_PARTY_LATE_DAYS} days, worth a reminder` : ''}`}
    >
      {withPartyLabel(days)}
    </span>
  );
}
