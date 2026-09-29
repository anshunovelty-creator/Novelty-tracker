'use client';
// src/components/admin/PaperStockManager.tsx
// BOM → Inventory: every paper roll on the rack, folded three deep —
// material ("BMB1450 · 2 widths · 13,650 m") → width ("110 mm — 4 full +
// 1 part · 8,650 m") → the individual rolls and the ledger of what came in
// and went out at that width.
//
// The BOM costing sheet reads the same list (query key ['paper-stock']) to
// show what's available when a material and width are picked, so a roll
// added here shows up there at once.
//
// paper_stock_manage adds, adjusts and deletes rolls; everyone else with
// BOM access reads.

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search, ChevronRight, Pencil, Trash2, Boxes } from 'lucide-react';
import { useFitToViewport } from '@/hooks/useFitToViewport';
import toast from 'react-hot-toast';
import { cn, formatNumericDate } from '@/lib/utils';
import { summariseStock, groupStockByMaterial, describeRolls, formatMeters, type StockLine, type MaterialGroup } from '@/lib/paperStock';
import type { BomMaterial, PaperRoll, PaperStockMovement, PaperStockMovementKind } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { usePaperStock } from '@/hooks/usePaperStock';
import { ReceiveRollsModal, AdjustRollModal, useRefreshStock, type ReceivePrefill } from './PaperStockModals';
import { SearchClearButton } from '@/components/ui/SearchClearButton';

const EMPTY_ROLLS: PaperRoll[] = [];
const EMPTY_MATERIALS: BomMaterial[] = [];

const COLUMNS = ['', 'Material / width', 'Rolls', 'In stock (m)', 'Location', 'Last received'] as const;

const KIND_LABEL: Record<PaperStockMovementKind, string> = {
  receive: 'Received', issue: 'Issued', return: 'Returned', adjust: 'Adjusted',
};

export default function PaperStockManager({ canManage }: { canManage: boolean }) {
  // The table scrolls, not the page — see useFitToViewport.
  const fitRef = useFitToViewport<HTMLDivElement>();
  const [search,   setSearch]   = useState('');
  // Material ids and width keys (stockKey) that are open. Several at once,
  // so widths of one material — or two materials — can be compared.
  const [openMaterials, setOpenMaterials] = useState<Set<string>>(() => new Set());
  const [openWidths,    setOpenWidths]    = useState<Set<string>>(() => new Set());
  const [adding,   setAdding]   = useState<ReceivePrefill | null>(null);
  const [adjusting, setAdjusting] = useState<PaperRoll | null>(null);

  const stockQuery = usePaperStock();
  const rolls = stockQuery.data ?? EMPTY_ROLLS;

  useEffect(() => {
    if (stockQuery.error) toast.error((stockQuery.error as Error).message);
  }, [stockQuery.error]);

  const materialsQuery = useQuery({
    queryKey: ['bom-materials'],
    queryFn: async () => {
      const res  = await fetch('/api/bom-materials');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load materials');
      return (data.materials ?? []) as BomMaterial[];
    },
    enabled: canManage,
  });
  const materials = materialsQuery.data ?? EMPTY_MATERIALS;

  const groups = useMemo(() => groupStockByMaterial(summariseStock(rolls)), [rolls]);

  // Search: a material-name hit keeps every width of that material; any
  // other hit (width, location, roll no.) keeps only the widths that match.
  // rollHits are the width keys matched by roll no., opened so the roll shows.
  const { visible, rollHits } = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return { visible: groups, rollHits: new Set<string>() };
    const hits = new Set<string>();
    const out: MaterialGroup[] = [];
    for (const g of groups) {
      if (g.material_name.toLowerCase().includes(q)) { out.push(g); continue; }
      const lines = g.lines.filter((l) => {
        const byRoll = l.roll_list.some((r) => r.ref.toLowerCase().includes(q));
        if (byRoll) hits.add(l.key);
        return byRoll || String(l.width_mm).includes(q) || l.locations.some((loc) => loc.toLowerCase().includes(q));
      });
      if (lines.length > 0) out.push(groupStockByMaterial(lines)[0]);
    }
    return { visible: out, rollHits: hits };
  }, [groups, search]);

  // Typing a search opens every material it matched (and the widths a roll
  // no. matched); clearing it folds everything back up.
  useEffect(() => {
    if (!search.trim()) {
      setOpenMaterials(new Set());
      setOpenWidths(new Set());
      return;
    }
    setOpenMaterials(new Set(visible.map((g) => g.material_id)));
    setOpenWidths(new Set(rollHits));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-open on search change only, not on every stock refetch
  }, [search]);

  const totals = useMemo(
    () => visible.reduce(
      (t, g) => ({ widths: t.widths + g.lines.length, rolls: t.rolls + g.rolls, meters: t.meters + g.meters }),
      { widths: 0, rolls: 0, meters: 0 },
    ),
    [visible],
  );

  const toggle = (setter: typeof setOpenMaterials, key: string) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--glass-muted)]" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search material, width, location or roll no."
            aria-label="Search paper stock"
            data-global-search
            className={cn(inputClass, 'w-full pl-9 pr-11')}
          />
          <SearchClearButton value={search} onClear={() => setSearch('')} />
        </div>
        {canManage && (
          <Button intent="primary" icon={Plus} onClick={() => setAdding({})}>Add rolls</Button>
        )}
      </div>

      {!stockQuery.isLoading && groups.length > 0 && (
        <p className="text-sm text-[var(--glass-muted)]">
          <strong className="text-[var(--glass-ink)]">{visible.length}</strong> {visible.length === 1 ? 'material' : 'materials'}
          {' · '}<strong className="text-[var(--glass-ink)]">{totals.widths}</strong> {totals.widths === 1 ? 'width' : 'widths'}
          {' · '}<strong className="text-[var(--glass-ink)]">{totals.rolls}</strong> {totals.rolls === 1 ? 'roll' : 'rolls'}
          {' · '}<strong className="font-mono text-[var(--glass-ink)]">{formatMeters(totals.meters)} m</strong> in stock
        </p>
      )}

      {stockQuery.isLoading ? (
        <div className="rounded-xl glass overflow-hidden">
          <table className="w-full text-sm"><tbody><SkeletonRows rows={5} cols={COLUMNS.length} /></tbody></table>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center rounded-xl border border-black/[0.08] bg-white px-4 py-12">
          <Boxes className="w-6 h-6 text-[var(--glass-muted)]" aria-hidden="true" />
          <p className="text-sm font-medium text-[var(--glass-ink)] mt-3">
            {search ? 'Nothing in stock matches that search.' : 'No paper in stock yet.'}
          </p>
          <p className="text-xs text-[var(--glass-muted)] mt-1 max-w-[46ch]">
            {search
              ? 'Try the material name, the width in mm, or a roll number.'
              : canManage
                ? 'Press Add rolls to enter what’s on the rack — e.g. 5 rolls × 2000 m of a material at 110 mm.'
                : 'Rolls appear here once Production or Admin enters them.'}
          </p>
        </div>
      ) : (
        <div className="rounded-xl glass overflow-hidden">
          <div ref={fitRef} className="table-scroll-wrapper relative max-h-[70vh] overflow-y-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr>
                  {COLUMNS.map((col, i) => (
                    <th key={i} scope="col" className={cn(headerClass, col === 'In stock (m)' && 'text-right', i === 0 && 'w-10')}>
                      {col}
                    </th>
                  ))}
                  {canManage && <th scope="col" className={cn(headerClass, 'w-px')}><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {visible.map((group) => {
                  const materialOpen = openMaterials.has(group.material_id);
                  return (
                    <Fragment key={group.material_id}>
                      {/* Level 1 — the material */}
                      <tr
                        className={cn('border-b border-white/8 cursor-pointer transition-colors hover:bg-black/[0.03]', materialOpen && 'bg-black/[0.03]')}
                        onClick={() => toggle(setOpenMaterials, group.material_id)}
                      >
                        <td className="px-2 py-2">
                          <ExpandButton
                            open={materialOpen}
                            label={`widths of ${group.material_name}`}
                            onToggle={() => toggle(setOpenMaterials, group.material_id)}
                          />
                        </td>
                        <td className={cn(cellClass, 'font-semibold text-[var(--glass-ink)]')}>{group.material_name}</td>
                        <td className={cellClass}>
                          <span className="text-[var(--glass-ink)]">{group.rolls} {group.rolls === 1 ? 'roll' : 'rolls'}</span>
                          <span className="text-[var(--glass-muted)]"> · {group.lines.length} {group.lines.length === 1 ? 'width' : 'widths'}</span>
                        </td>
                        <td className={cn(cellClass, 'font-mono font-semibold text-right text-[var(--glass-ink)]')}>{formatMeters(group.meters)}</td>
                        <td className={cn(cellClass, 'text-[var(--glass-muted)]')}>{group.locations.join(', ') || '—'}</td>
                        <td className={cn(cellClass, 'font-mono text-[var(--glass-muted)]')}>{formatNumericDate(group.last_received)}</td>
                        {canManage && (
                          <td className="px-2 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                            <Button
                              size="sm" icon={Plus}
                              aria-label={`Add rolls of ${group.material_name}`}
                              title={`Add rolls of ${group.material_name}`}
                              onClick={() => setAdding({ material_id: group.material_id })}
                            />
                          </td>
                        )}
                      </tr>

                      {/* Level 2 — each width of it */}
                      {materialOpen && group.lines.map((line) => {
                        const widthOpen = openWidths.has(line.key);
                        return (
                          <Fragment key={line.key}>
                            <tr
                              className={cn('border-b border-white/8 cursor-pointer transition-colors bg-black/[0.015] hover:bg-black/[0.04]', widthOpen && 'bg-black/[0.04]')}
                              onClick={() => toggle(setOpenWidths, line.key)}
                            >
                              <td />
                              <td className={cn(cellClass, 'pl-5')}>
                                <span className="flex items-center gap-1.5">
                                  <ExpandButton
                                    open={widthOpen}
                                    label={`rolls of ${line.material_name} ${line.width_mm} mm`}
                                    onToggle={() => toggle(setOpenWidths, line.key)}
                                  />
                                  <span className="font-mono text-[var(--glass-ink)]">{formatMeters(line.width_mm)} mm</span>
                                </span>
                              </td>
                              <td className={cn(cellClass, 'text-[var(--glass-ink)]')}>{describeRolls(line)}</td>
                              <td className={cn(cellClass, 'font-mono text-right text-[var(--glass-ink)]')}>{formatMeters(line.meters)}</td>
                              <td className={cn(cellClass, 'text-[var(--glass-muted)]')}>{line.locations.join(', ') || '—'}</td>
                              <td className={cn(cellClass, 'font-mono text-[var(--glass-muted)]')}>{formatNumericDate(line.last_received)}</td>
                              {canManage && <td />}
                            </tr>

                            {/* Level 3 — the rolls and their ledger */}
                            {widthOpen && (
                              <tr className="border-b border-white/8 bg-[var(--glass-bg)]">
                                <td colSpan={COLUMNS.length + (canManage ? 1 : 0)} className="py-3 pr-4 pl-12">
                                  <StockLineDetail line={line} canManage={canManage} onAdjust={setAdjusting} />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {adding && <ReceiveRollsModal materials={materials} prefill={adding} onClose={() => setAdding(null)} />}
      {adjusting && <AdjustRollModal roll={adjusting} onClose={() => setAdjusting(null)} />}
    </div>
  );
}

function ExpandButton({ open, label, onToggle }: { open: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`${open ? 'Hide' : 'Show'} ${label}`}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      className="p-1.5 rounded-md text-[var(--glass-muted)] hover:text-[var(--glass-ink)] hover:bg-black/[0.05]"
    >
      <ChevronRight className={cn('h-4 w-4 transition-transform motion-reduce:transition-none', open && 'rotate-90')} aria-hidden="true" />
    </button>
  );
}

// ── One expanded line: its rolls, then its ledger ─────────────────

function StockLineDetail({
  line, canManage, onAdjust,
}: {
  line: StockLine; canManage: boolean; onAdjust: (roll: PaperRoll) => void;
}) {
  const refresh = useRefreshStock();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const movementsQuery = useQuery({
    queryKey: ['paper-stock', 'movements', line.material_id, line.width_mm],
    queryFn: async () => {
      const params = new URLSearchParams({ material_id: line.material_id, width_mm: String(line.width_mm) });
      const res  = await fetch(`/api/paper-stock/movements?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load activity');
      return (data.movements ?? []) as PaperStockMovement[];
    },
  });

  // Part-used first, in the order Use-from-stock will take them.
  const rolls = [...line.roll_list].sort((a, b) => {
    const ap = a.remaining_meter < a.initial_meter ? 0 : 1;
    const bp = b.remaining_meter < b.initial_meter ? 0 : 1;
    return ap - bp || a.remaining_meter - b.remaining_meter || a.received_at.localeCompare(b.received_at);
  });

  async function remove(roll: PaperRoll) {
    setBusyId(roll.id);
    try {
      const res  = await fetch(`/api/paper-stock/${roll.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Failed to delete'); return; }
      toast.success(`${roll.ref} deleted`);
      refresh();
    } catch {
      toast.error('Network error');
    } finally {
      setBusyId(null);
      setConfirmDeleteId(null);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
      <div>
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--glass-muted)] mb-2">Rolls</h4>
        <ul className="divide-y divide-black/[0.06] rounded-lg border border-black/[0.08] bg-white">
          {rolls.map((roll) => {
            const pct = Math.round((roll.remaining_meter / roll.initial_meter) * 100);
            return (
              <li key={roll.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <span className="font-mono text-xs font-semibold text-[var(--glass-ink)] w-16">{roll.ref}</span>
                <div className="flex-1 min-w-[140px]">
                  <p className="font-mono text-sm text-[var(--glass-ink)]">
                    {formatMeters(roll.remaining_meter)} <span className="text-[var(--glass-muted)]">/ {formatMeters(roll.initial_meter)} m</span>
                  </p>
                  <div className="mt-1 h-1.5 rounded-full bg-black/[0.06] overflow-hidden" aria-hidden="true">
                    <div className={cn('h-full rounded-full', pct === 100 ? 'bg-emerald-500' : 'bg-amber-500')} style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <span className="text-xs text-[var(--glass-muted)]">
                  {[roll.location, roll.supplier, formatNumericDate(roll.received_at)].filter(Boolean).join(' · ')}
                </span>
                {canManage && (
                  <div className="flex items-center gap-1 ml-auto">
                    {confirmDeleteId === roll.id ? (
                      <>
                        <Button intent="danger" size="sm" busy={busyId === roll.id} onClick={() => remove(roll)}>Delete</Button>
                        <Button size="sm" onClick={() => setConfirmDeleteId(null)}>Keep</Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" icon={Pencil} onClick={() => onAdjust(roll)}>Adjust</Button>
                        <Button
                          size="sm" intent="danger" icon={Trash2}
                          aria-label={`Delete ${roll.ref}`}
                          title="Delete a roll entered by mistake — use Adjust → 0 to write off a used roll"
                          onClick={() => setConfirmDeleteId(roll.id)}
                        />
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div>
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--glass-muted)] mb-2">Activity</h4>
        {movementsQuery.isLoading ? (
          <p className="text-xs text-[var(--glass-muted)]">Loading…</p>
        ) : (movementsQuery.data ?? []).length === 0 ? (
          <p className="text-xs text-[var(--glass-muted)]">No activity yet.</p>
        ) : (
          <ul className="max-h-72 overflow-y-auto space-y-1.5 text-xs">
            {(movementsQuery.data ?? []).map((m) => (
              <li key={m.id} className="flex items-baseline gap-2">
                <span className={cn('font-mono font-semibold tabular-nums w-20 text-right shrink-0', m.meters > 0 ? 'text-emerald-800' : 'text-red-700')}>
                  {m.meters > 0 ? '+' : '−'}{formatMeters(Math.abs(m.meters))}
                </span>
                <span className="min-w-0 text-[var(--glass-ink)]">
                  {KIND_LABEL[m.kind]}
                  {m.roll_ref && <span className="font-mono text-[var(--glass-muted)]"> {m.roll_ref}</span>}
                  {m.job_label && <> · {m.job_label}</>}
                  {m.note && <span className="text-[var(--glass-muted)]"> — {m.note}</span>}
                  <span className="block text-[10px] text-[var(--glass-muted)]">
                    {formatNumericDate(m.created_at)}{m.created_by ? ` · ${m.created_by}` : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const inputClass =
  'min-h-11 px-3 rounded-lg text-sm bg-[var(--field-bg)] border border-[var(--field-border)] text-[var(--glass-ink)] ' +
  'placeholder:text-[var(--glass-muted)] focus:outline-none focus:border-emerald-300/70 ' +
  'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all';

const headerClass =
  'sticky top-0 z-10 px-3 py-1.5 text-left text-[11px] font-semibold text-[var(--glass-muted)] uppercase tracking-[0.06em] ' +
  'whitespace-nowrap bg-[var(--glass-bg-strong)] backdrop-blur-[14px] border-b border-white/12';

const cellClass = 'px-3 py-2 align-middle whitespace-nowrap';
