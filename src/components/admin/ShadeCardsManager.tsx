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
import { Search, Plus, Pencil, Trash2, GitBranch, ChevronLeft, ChevronRight } from 'lucide-react';
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

type Props = {
  canManage: boolean;
  canDelete: boolean;
};

export default function ShadeCardsManager({ canManage, canDelete }: Props) {
  const queryClient = useQueryClient();

  const [search,  setSearch]  = useState('');
  const [field,   setField]   = useState('all');
  const [status,  setStatus]  = useState('');
  const [making,  setMaking]  = useState('');
  const [page,    setPage]    = useState(1);

  const [modal,      setModal]      = useState<{ mode: ShadeCardModalMode; card?: ShadeCard } | null>(null);
  const [confirmId,  setConfirmId]  = useState<string | null>(null);
  const [busyId,     setBusyId]     = useState<string | null>(null);

  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (search && field !== 'all') params.set('field', field);
  if (status) params.set('status', status);
  if (making) params.set('making', making);
  params.set('page', String(page));

  const { data, isLoading } = useQuery<ListResponse>({
    queryKey: ['shade-cards', search, field, status, making, page],
    queryFn: async () => {
      const res = await fetch(`/api/shade-cards?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load shade cards');
      return res.json();
    },
    // Keeps the previous page on screen while the next one loads, so paging
    // doesn't blank the table on every click.
    placeholderData: keepPreviousData,
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

  const hasFilters = Boolean(search || status || making);

  return (
    <div className="space-y-3">
      {/* ── controls ─────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
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

      {/* Count reads off the server total, not the loaded page — otherwise it
          would always say 25. */}
      <p className="text-sm text-[var(--glass-muted)]">
        <strong className="text-[var(--glass-ink)]">{total.toLocaleString('en-IN')}</strong>
        {total === 1 ? ' shade card' : ' shade cards'}
        {hasFilters && ' matching your filters'}
      </p>

      {/* ── desk table ───────────────────────────────────────── */}
      <div className="hidden sm:block rounded-xl glass overflow-hidden">
        <div className="table-scroll-wrapper max-h-[70vh] overflow-y-auto">
          <table className="w-full min-w-[1100px] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-[var(--glass-bg-strong)] backdrop-blur">
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c} scope="col"
                      className="px-4 py-2.5 text-left text-xs font-semibold text-[var(--glass-muted)] whitespace-nowrap">
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
              ) : cards.map((c) => (
                <tr key={c.id} className="border-t border-black/[0.06] hover:bg-black/[0.02]">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/shade-cards/${c.id}`}
                      className="font-medium text-[var(--glass-ink)] hover:underline underline-offset-2"
                    >
                      {c.party}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[var(--glass-ink)]">{c.product_name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-[var(--glass-muted)]">{c.shade_card_number ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-[var(--glass-muted)]">{c.pm_code ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-[var(--glass-muted)]">{formatNumericDate(c.prepared_date)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-[var(--glass-muted)]">{formatNumericDate(c.approval_date)}</td>
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
        <div className="flex items-center justify-between gap-3 pt-1">
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
