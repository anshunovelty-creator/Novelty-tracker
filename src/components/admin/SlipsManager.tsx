'use client';
// src/components/admin/SlipsManager.tsx
// ============================================================
// Box slips and roll slips — pick a job once, print either.
// Replaces retyping both templates into BarTender for every consignment.
// ============================================================
//
// WHY ONE PAGE FOR TWO SLIPS
// Dispatch prints both for the same consignment, off the same job. Two
// separate pages would mean searching for that job twice and re-entering the
// date twice, so the job and the date are held here and the tab only swaps
// the fields that genuinely differ.
//
// HOW PRINTING WORKS HERE
// No print server, no local agent. Slips render into #slip-print-root, the
// @media print block hides everything else, and window.print() hands the
// result to the TSC P210's ordinary Windows driver.
//
// WHY THE PRINT SURFACE IS PORTALLED TO <body>
// It has to be a direct child of body so the print stylesheet can
// `display: none` its siblings. That matters more than it sounds:
//
//   - `visibility: hidden` (the obvious alternative) hides the admin shell
//     but leaves it occupying layout, so a page of UI still paginates into
//     several blank sheets of label stock.
//   - Escaping that with `position: absolute` puts the sheets inside an
//     absolutely positioned box, and Chrome does not reliably honour forced
//     page breaks inside one. That is what broke sheet ganging: four roll
//     slips meant to share a sheet came out on four separate labels.
//
// As a body-level child in normal flow, each .slip-sheet is an ordinary
// block that `break-after: page` can act on, which is all this needs.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { Printer, Search, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import BoxSlipLabel, {
  BOX_SLIP_WIDTH_MM,
  BOX_SLIP_HEIGHT_MM,
  type BoxSlipLabelData,
} from './BoxSlipLabel';
import RollSlipLabel, {
  ROLL_SLIP_WIDTH_MM,
  ROLL_SLIP_HEIGHT_MM,
  ROLL_SLIPS_PER_SHEET,
  ROLL_SLIP_COLUMNS,
  type RollSlipLabelData,
} from './RollSlipLabel';
import type { BoxSlip, RollSlip, Job } from '@/lib/types';

type SlipKind = 'box' | 'roll';

/**
 * The one media loaded in the P210: 6" x 4". Both slips print on it, so the
 * printed page is always this size — a box slip fills a sheet, roll slips
 * gang four to a sheet in a 2x2 grid.
 */
const SHEET = { w: BOX_SLIP_WIDTH_MM, h: BOX_SLIP_HEIGHT_MM };

/** How much of a sheet one slip occupies — used for the on-screen preview. */
const SLIP_SIZE: Record<SlipKind, { w: number; h: number }> = {
  box:  { w: BOX_SLIP_WIDTH_MM,  h: BOX_SLIP_HEIGHT_MM },
  roll: { w: ROLL_SLIP_WIDTH_MM, h: ROLL_SLIP_HEIGHT_MM },
};

const PER_SHEET: Record<SlipKind, number> = { box: 1, roll: ROLL_SLIPS_PER_SHEET };

/** Splits a flat run of slips into sheet-sized chunks. */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const FIELD = cn(
  'w-full min-h-11 px-3 rounded-xl text-sm',
  'bg-[var(--field-bg)] border border-[var(--field-border)] text-[var(--glass-ink)]',
  'placeholder:text-[var(--glass-muted)] focus:outline-none',
  'focus:border-emerald-300/70 focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
);

const LABEL_CLS = 'block text-xs font-medium text-[var(--glass-muted)] mb-1';

/**
 * Today as 'YYYY-MM-DD' in the operator's own timezone.
 * `toISOString()` would convert to UTC first and print yesterday's date on
 * every consignment packed after 05:30 IST.
 */
function todayLocalISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type PrintRequest =
  | { kind: 'box';  data: BoxSlipLabelData;  copies: number; token: number }
  | { kind: 'roll'; data: RollSlipLabelData; copies: number; token: number };

type Props = { canPrintBox: boolean; canPrintRoll: boolean };

export default function SlipsManager({ canPrintBox, canPrintRoll }: Props) {
  const [kind, setKind] = useState<SlipKind>('box');

  // ── Job selection, shared by both slips ─────────────────────
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Job[]>([]);
  const [searching, setSearching] = useState(false);
  const [job, setJob] = useState<Job | null>(null);

  // The date is shared too: it is the same physical packing day whichever
  // slip is being printed (MFG DATE on the box, under SUPPLIER on the roll).
  const [date, setDate] = useState(todayLocalISO);

  // ── Box-slip fields ─────────────────────────────────────────
  const [materialName, setMaterialName] = useState('');
  const [qtyPerBox, setQtyPerBox] = useState('');
  const [boxCount, setBoxCount] = useState('1');

  // ── Roll-slip fields ────────────────────────────────────────
  const [product, setProduct] = useState('');
  const [qtyPerRoll, setQtyPerRoll] = useState('');
  const [rollCount, setRollCount] = useState('1');
  const [direction, setDirection] = useState('');
  const [operator, setOperator] = useState('');

  const [saving, setSaving] = useState(false);
  const [boxHistory, setBoxHistory] = useState<BoxSlip[]>([]);
  const [rollHistory, setRollHistory] = useState<RollSlip[]>([]);
  const [printReq, setPrintReq] = useState<PrintRequest | null>(null);
  const printToken = useRef(0);

  // Resolved after mount: document.body does not exist during SSR, and the
  // print surface must hang off it rather than off this component's subtree.
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  useEffect(() => setPortalTarget(document.body), []);

  const canPrint = kind === 'box' ? canPrintBox : canPrintRoll;

  // ── Job search, debounced ───────────────────────────────────
  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/jobs?search=${encodeURIComponent(term)}`);
        const data = await res.json();
        setResults(res.ok ? (data.jobs ?? []).slice(0, 8) : []);
      } catch {
        // A failed lookup leaves results alone rather than flashing an error
        // toast on every keystroke over a flaky shop-floor link.
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const loadHistory = useCallback(async (jobId?: string) => {
    const qs = jobId ? `?job_id=${encodeURIComponent(jobId)}` : '';
    // Both lists refresh together so switching tabs never shows stale rows.
    const load = async (path: string) => {
      try {
        const res = await fetch(`${path}${qs}`);
        const data = await res.json();
        return res.ok ? (data.slips ?? []) : [];
      } catch {
        // History is a convenience — its absence must never block a print.
        return [];
      }
    };
    const [box, roll] = await Promise.all([load('/api/box-slips'), load('/api/roll-slips')]);
    setBoxHistory(box);
    setRollHistory(roll);
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  function selectJob(j: Job) {
    setJob(j);
    setSearch('');
    setResults([]);
    // Prefill everything the job already knows — the whole point of this page.
    // The sample slips pack an order into one unit, so that is the default
    // shape; the operator corrects it when the consignment actually splits.
    const name = j.job_name ?? '';
    setMaterialName(name);
    setProduct(name);
    setQtyPerBox(j.label_qty ? String(j.label_qty) : '');
    setBoxCount('1');
    setQtyPerRoll('');
    setRollCount('1');
    loadHistory(j.id);
  }

  // ── Validation ──────────────────────────────────────────────
  const boxQty = Number(qtyPerBox);
  const boxes = Number(boxCount);
  const rollQty = Number(qtyPerRoll);
  const rolls = Number(rollCount);

  const problem = useMemo(() => {
    if (!job) return 'Pick a job first';
    if (!date) return 'Date is required';
    if (kind === 'box') {
      if (!materialName.trim()) return 'Material name is required';
      if (!Number.isInteger(boxQty) || boxQty <= 0) return 'Quantity per box must be a whole number';
      if (!Number.isInteger(boxes) || boxes <= 0) return 'Number of boxes must be a whole number';
      if (boxes > 200) return 'That would print more than 200 slips';
    } else {
      if (!product.trim()) return 'Product is required';
      if (!Number.isInteger(rollQty) || rollQty <= 0) return 'Quantity per roll must be a whole number';
      if (!Number.isInteger(rolls) || rolls <= 0) return 'Number of rolls must be a whole number';
      if (rolls > 500) return 'That would print more than 500 slips';
    }
    return null;
  }, [job, date, kind, materialName, boxQty, boxes, product, rollQty, rolls]);

  const boxPreview: BoxSlipLabelData = {
    materialName: materialName.trim() || 'MATERIAL NAME',
    pmCode: job?.pm_code ?? null,
    qtyPerBox: Number.isFinite(boxQty) && boxQty > 0 ? boxQty : 0,
    boxCount: Number.isFinite(boxes) && boxes > 0 ? boxes : 1,
    mfgDate: date,
  };

  const rollPreview: RollSlipLabelData = {
    product: product.trim() || 'PRODUCT',
    pmCode: job?.pm_code ?? null,
    qtyPerRoll: Number.isFinite(rollQty) && rollQty > 0 ? rollQty : 0,
    direction: direction.trim() || null,
    operator: operator.trim() || null,
    slipDate: date,
    poNumber: job?.po_number ?? null,
    party: job?.party ?? '',
  };

  // ── Printing ────────────────────────────────────────────────
  // Rendering the copies and calling window.print() cannot happen in the
  // same tick: print() snapshots the DOM synchronously, so it has to wait
  // for React to commit first.
  useEffect(() => {
    if (!printReq) return;
    const raf = requestAnimationFrame(() => {
      window.print();
      setPrintReq(null);
    });
    return () => cancelAnimationFrame(raf);
  }, [printReq]);

  function firePrint(req: Omit<PrintRequest, 'token'>) {
    printToken.current += 1;
    setPrintReq({ ...req, token: printToken.current } as PrintRequest);
  }

  async function handlePrint() {
    if (problem) { toast.error(problem); return; }

    const endpoint = kind === 'box' ? '/api/box-slips' : '/api/roll-slips';
    const payload = kind === 'box'
      ? {
          job_id: job!.id,
          material_name: materialName.trim(),
          qty_per_box: boxQty,
          box_count: boxes,
          mfg_date: date,
        }
      : {
          job_id: job!.id,
          product: product.trim(),
          qty_per_roll: rollQty,
          roll_count: rolls,
          direction: direction.trim(),
          operator: operator.trim(),
          slip_date: date,
        };

    setSaving(true);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Could not record the batch'); return; }

      // Print the recorded values rather than the form's: if the server
      // corrected or defaulted anything, the label must match the record.
      if (kind === 'box') {
        const s: BoxSlip = data.slip;
        firePrint({
          kind: 'box',
          copies: s.box_count,
          data: {
            materialName: s.material_name,
            pmCode: s.pm_code,
            qtyPerBox: s.qty_per_box,
            boxCount: s.box_count,
            mfgDate: s.mfg_date,
          },
        });
        toast.success(`${s.box_count} box slip${s.box_count > 1 ? 's' : ''} sent to the printer`);
      } else {
        const s: RollSlip = data.slip;
        firePrint({
          kind: 'roll',
          copies: s.roll_count,
          data: {
            product: s.product,
            pmCode: s.pm_code,
            qtyPerRoll: s.qty_per_roll,
            direction: s.direction,
            operator: s.operator,
            slipDate: s.slip_date,
            poNumber: s.po_number,
            party: s.party,
          },
        });
        toast.success(`${s.roll_count} roll slip${s.roll_count > 1 ? 's' : ''} sent to the printer`);
      }
      loadHistory(job!.id);
    } catch {
      toast.error('Could not reach the server');
    } finally {
      setSaving(false);
    }
  }

  /** One slip, not recorded — for lining the stock up in the printer. */
  function handleTestPrint() {
    if (kind === 'box') {
      if (!Number.isInteger(boxQty) || boxQty <= 0) { toast.error('Enter a quantity per box first'); return; }
      firePrint({ kind: 'box', data: boxPreview, copies: 1 });
    } else {
      if (!Number.isInteger(rollQty) || rollQty <= 0) { toast.error('Enter a quantity per roll first'); return; }
      firePrint({ kind: 'roll', data: rollPreview, copies: 1 });
    }
  }

  function reprintBox(s: BoxSlip) {
    firePrint({
      kind: 'box',
      copies: s.box_count,
      data: {
        materialName: s.material_name,
        pmCode: s.pm_code,
        qtyPerBox: s.qty_per_box,
        boxCount: s.box_count,
        mfgDate: s.mfg_date,
      },
    });
  }

  function reprintRoll(s: RollSlip) {
    firePrint({
      kind: 'roll',
      copies: s.roll_count,
      data: {
        product: s.product,
        pmCode: s.pm_code,
        qtyPerRoll: s.qty_per_roll,
        direction: s.direction,
        operator: s.operator,
        slipDate: s.slip_date,
        poNumber: s.po_number,
        party: s.party,
      },
    });
  }

  const copies = kind === 'box' ? boxes : rolls;
  const unit = kind === 'box' ? 'box' : 'roll';
  const history = kind === 'box' ? boxHistory : rollHistory;

  // Stock consumed, which is what the operator at the printer actually cares
  // about: 5 roll slips is two sheets, not five.
  const sheets =
    Number.isInteger(copies) && copies > 0
      ? Math.ceil(copies / PER_SHEET[kind])
      : 0;

  return (
    <div className="space-y-4">
      {/* ── Which slip ─────────────────────────────────────── */}
      <div
        role="tablist"
        aria-label="Slip type"
        className="inline-flex rounded-xl border border-[var(--field-border)] p-1 gap-1"
      >
        {(['box', 'roll'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={kind === k}
            onClick={() => setKind(k)}
            className={cn(
              'min-h-9 px-4 rounded-lg text-sm font-medium transition-colors',
              kind === k
                ? 'bg-brand-primary text-white'
                : 'text-[var(--glass-muted)] hover:bg-black/[0.04]',
            )}
          >
            {k === 'box' ? 'Box slip' : 'Roll slip'}
            <span className="ml-1.5 text-xs opacity-70">
              {/* What the operator loads and cuts, not the artwork size: both
                  print on the same 6x4 stock, and the roll slip's number is
                  how many come off one piece of it. */}
              {k === 'box' ? '6″ × 4″' : `${ROLL_SLIPS_PER_SHEET} per 6″ × 4″`}
            </span>
          </button>
        ))}
      </div>

      {/* ── Job picker ─────────────────────────────────────── */}
      <div className="relative">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--glass-muted)]"
          aria-hidden="true"
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search a job by card no, PO, party or job name"
          aria-label="Search for a job to print slips for"
          className={cn(FIELD, 'pl-9')}
        />
        {results.length > 0 && (
          <ul
            className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto rounded-xl border border-[var(--field-border)] bg-white shadow-lg"
            role="listbox"
            aria-label="Matching jobs"
          >
            {results.map((j) => (
              <li key={j.id}>
                <button
                  type="button"
                  onClick={() => selectJob(j)}
                  className="w-full text-left px-3 py-2.5 hover:bg-black/[0.04] transition-colors"
                >
                  <span className="block text-sm text-[var(--glass-ink)]">
                    {j.party} — {j.job_name ?? 'Untitled'}
                  </span>
                  <span className="block text-xs text-[var(--glass-muted)] mt-0.5">
                    {j.job_card_number ?? '—'} · PO {j.po_number}
                    {j.pm_code ? ` · PM ${j.pm_code}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {searching && search.trim().length >= 2 && results.length === 0 && (
          <p className="mt-1 text-xs text-[var(--glass-muted)]">Searching…</p>
        )}
      </div>

      {!job && (
        <p className="text-sm text-[var(--glass-muted)]">
          Pick a job and its party, product and PM code fill themselves in.
          You only enter what the app cannot know.
        </p>
      )}

      {job && (
        <>
          <div className="rounded-2xl border border-[var(--field-border)] p-4 space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium text-[var(--glass-ink)]">
                {job.party}
                <span className="text-[var(--glass-muted)] font-normal">
                  {' '}· PO {job.po_number}{job.pm_code ? ` · PM ${job.pm_code}` : ''}
                </span>
              </p>
              <button
                type="button"
                onClick={() => { setJob(null); loadHistory(); }}
                className="text-xs text-[var(--glass-muted)] underline underline-offset-2 hover:opacity-70"
              >
                Change job
              </button>
            </div>

            {kind === 'box' ? (
              <>
                <div>
                  <label className={LABEL_CLS} htmlFor="s-material">Material name</label>
                  <input
                    id="s-material"
                    value={materialName}
                    onChange={(e) => setMaterialName(e.target.value)}
                    placeholder="STICKER LABEL PET BOTTLE 1 LTR TRACKER"
                    className={FIELD}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className={LABEL_CLS} htmlFor="s-boxqty">Labels per box</label>
                    <input id="s-boxqty" type="number" inputMode="numeric" min={1}
                      value={qtyPerBox} onChange={(e) => setQtyPerBox(e.target.value)} className={FIELD} />
                  </div>
                  <div>
                    <label className={LABEL_CLS} htmlFor="s-boxes">Number of boxes</label>
                    <input id="s-boxes" type="number" inputMode="numeric" min={1}
                      value={boxCount} onChange={(e) => setBoxCount(e.target.value)} className={FIELD} />
                  </div>
                  <div>
                    <label className={LABEL_CLS} htmlFor="s-date">Manufacturing date</label>
                    <input id="s-date" type="date" value={date}
                      onChange={(e) => setDate(e.target.value)} className={FIELD} />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className={LABEL_CLS} htmlFor="s-product">Product</label>
                  <input
                    id="s-product"
                    value={product}
                    onChange={(e) => setProduct(e.target.value)}
                    placeholder="INTIMATE WASH LABELS"
                    className={FIELD}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className={LABEL_CLS} htmlFor="s-rollqty">Labels per roll</label>
                    <input id="s-rollqty" type="number" inputMode="numeric" min={1}
                      value={qtyPerRoll} onChange={(e) => setQtyPerRoll(e.target.value)} className={FIELD} />
                  </div>
                  <div>
                    <label className={LABEL_CLS} htmlFor="s-rolls">Number of rolls</label>
                    <input id="s-rolls" type="number" inputMode="numeric" min={1}
                      value={rollCount} onChange={(e) => setRollCount(e.target.value)} className={FIELD} />
                  </div>
                  <div>
                    <label className={LABEL_CLS} htmlFor="s-rolldate">Date</label>
                    <input id="s-rolldate" type="date" value={date}
                      onChange={(e) => setDate(e.target.value)} className={FIELD} />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={LABEL_CLS} htmlFor="s-direction">Winding direction</label>
                    <input id="s-direction" value={direction}
                      onChange={(e) => setDirection(e.target.value)}
                      placeholder="#4" className={FIELD} />
                  </div>
                  <div>
                    <label className={LABEL_CLS} htmlFor="s-operator">Operator</label>
                    <input id="s-operator" value={operator}
                      onChange={(e) => setOperator(e.target.value)}
                      placeholder="N & BH" className={FIELD} />
                  </div>
                </div>
              </>
            )}

            <p className="text-xs text-[var(--glass-muted)]">
              {sheets > 0
                ? kind === 'roll'
                  ? `${copies} slip${copies > 1 ? 's' : ''} — one per roll, ${ROLL_SLIPS_PER_SHEET} to a 6″ × 4″ sheet, so ${sheets} sheet${sheets > 1 ? 's' : ''} of stock.`
                  : `${copies} identical slip${copies > 1 ? 's' : ''} will print — one per box.`
                : `Enter how many ${unit}s to print a slip for each.`}
            </p>
          </div>

          {/* ── Preview, at true physical size ─────────────── */}
          <div>
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <h2 className="text-sm font-medium text-[var(--glass-ink)]">Preview</h2>
              <p className="text-xs text-[var(--glass-muted)]">
                One 6″ × 4″ sheet, actual size — slip is {SLIP_SIZE[kind].w} × {SLIP_SIZE[kind].h} mm
              </p>
            </div>
            {/* The preview is a whole sheet, not a lone slip: what matters at
                the printer is what comes out of it. For rolls that means
                seeing the 2x2 tiling, and seeing the blanks on a short sheet. */}
            <div className="overflow-x-auto rounded-2xl border border-[var(--field-border)] bg-[#EEF1F5] p-4">
              <div
                className="shadow-sm rounded-[3mm] overflow-hidden mx-auto bg-white"
                style={{
                  width: `${SHEET.w}mm`,
                  height: `${SHEET.h}mm`,
                  display: 'grid',
                  gridTemplateColumns:
                    kind === 'roll'
                      ? `repeat(${ROLL_SLIP_COLUMNS}, ${ROLL_SLIP_WIDTH_MM}mm)`
                      : '1fr',
                  gridAutoRows: kind === 'roll' ? `${ROLL_SLIP_HEIGHT_MM}mm` : 'auto',
                }}
              >
                {kind === 'box' ? (
                  <BoxSlipLabel data={boxPreview} />
                ) : (
                  Array.from(
                    { length: Math.min(copies > 0 ? copies : 1, ROLL_SLIPS_PER_SHEET) },
                    (_, i) => <RollSlipLabel key={i} data={rollPreview} />,
                  )
                )}
              </div>
            </div>
            {kind === 'roll' && (
              <p className="mt-2 text-xs text-[var(--glass-muted)]">
                Four to a sheet, cut apart along the borders. The QR opens this
                job&rsquo;s live tracking page for the client.
              </p>
            )}
          </div>

          {/* ── Actions ────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              intent="primary"
              icon={Printer}
              busy={saving}
              disabled={!canPrint || !!problem}
              onClick={handlePrint}
              title={problem ?? undefined}
            >
              Print {Number.isInteger(copies) && copies > 1 ? `${copies} slips` : 'slip'}
            </Button>
            <Button intent="ghost" onClick={handleTestPrint}>
              Test print (not recorded)
            </Button>
            {!canPrint && (
              <p className="text-xs text-[var(--glass-muted)]">
                Your department can view slips but not print them.
              </p>
            )}
          </div>
        </>
      )}

      {/* ── Recent batches for the open tab ──────────────────── */}
      {history.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-[var(--glass-ink)] mb-2">
            {job ? 'Printed for this job' : 'Recently printed'}
          </h2>
          <ul className="divide-y divide-[var(--field-border)] rounded-2xl border border-[var(--field-border)]">
            {kind === 'box'
              ? boxHistory.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm text-[var(--glass-ink)] truncate">{s.material_name}</p>
                      <p className="text-xs text-[var(--glass-muted)]">
                        {s.qty_per_box} × {s.box_count} box · {s.party}
                        {s.pm_code ? ` · PM ${s.pm_code}` : ''}
                      </p>
                    </div>
                    <Button size="sm" intent="ghost" icon={RotateCcw} onClick={() => reprintBox(s)}>
                      Reprint
                    </Button>
                  </li>
                ))
              : rollHistory.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm text-[var(--glass-ink)] truncate">{s.product}</p>
                      <p className="text-xs text-[var(--glass-muted)]">
                        {s.qty_per_roll} NOS × {s.roll_count} roll · {s.party}
                        {s.direction ? ` · Dir ${s.direction}` : ''}
                      </p>
                    </div>
                    <Button size="sm" intent="ghost" icon={RotateCcw} onClick={() => reprintRoll(s)}>
                      Reprint
                    </Button>
                  </li>
                ))}
          </ul>
        </div>
      )}

      {/* ── The surface that actually prints ─────────────────── */}
      {/* One .slip-sheet per physical 6"x4" label. A box slip fills its
          sheet; roll slips gang four to a sheet, so the last sheet of an
          odd run is simply short — 5 rolls is a full sheet plus a sheet
          holding one, with the other three quarters left blank. */}
      {portalTarget &&
        createPortal(
          <div id="slip-print-root" aria-hidden="true">
            {printReq &&
              chunk(
                Array.from({ length: printReq.copies }, (_, i) => i),
                PER_SHEET[printReq.kind],
              ).map((sheet, sheetIndex) => (
                <div
                  key={`${printReq.token}-sheet-${sheetIndex}`}
                  className="slip-sheet"
                  style={{
                    width: `${SHEET.w}mm`,
                    height: `${SHEET.h}mm`,
                    boxSizing: 'border-box',
                    background: '#fff',
                    // Nothing may spill past the sheet edge: an overflow of
                    // even a fraction of a millimetre is enough for the
                    // browser to push the second row onto its own label.
                    overflow: 'hidden',
                    display: 'grid',
                    // Roll slips tile 2-up; a box slip is a single full cell.
                    gridTemplateColumns:
                      printReq.kind === 'roll'
                        ? `repeat(${ROLL_SLIP_COLUMNS}, ${ROLL_SLIP_WIDTH_MM}mm)`
                        : '1fr',
                    gridAutoRows:
                      printReq.kind === 'roll' ? `${ROLL_SLIP_HEIGHT_MM}mm` : 'auto',
                  }}
                >
                  {sheet.map((slipIndex) =>
                    printReq.kind === 'box' ? (
                      <BoxSlipLabel key={slipIndex} data={printReq.data} />
                    ) : (
                      <RollSlipLabel key={slipIndex} data={printReq.data} />
                    ),
                  )}
                </div>
              ))}
          </div>,
          portalTarget,
        )}

      {/* dangerouslySetInnerHTML, not a text child. React escapes text when
          server-rendering, so a `"` in here arrives as `&quot;` — and <style>
          is a raw-text element, so the parser never decodes it back. The
          server and client text then differ, hydration fails, and React
          throws away the server HTML to re-render the whole root. Nothing
          here is user input; it is a constant built from the label sizes. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        #slip-print-root {
          position: fixed;
          left: -10000px;
          top: 0;
        }

        @media print {
          /* The page IS the label, and there is only ever one stock loaded:
             6" x 4". No margin, or the driver centres the sheet on an A4 page
             and scales it down. */
          @page {
            size: ${SHEET.w}mm ${SHEET.h}mm;
            margin: 0;
          }

          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
            width: auto !important;
            height: auto !important;
          }

          /* Remove the admin shell from layout entirely rather than merely
             hiding it. visibility:hidden would leave a page of UI still
             occupying flow, which paginates into blank labels; display:none
             is what actually reclaims the pages. This works only because the
             print surface is portalled to be a sibling of that shell rather
             than a descendant of it. */
          body > *:not(#slip-print-root) { display: none !important; }

          /* Back into normal flow: a forced page break inside an absolutely
             positioned box is not reliably honoured, which is exactly what
             stopped four roll slips sharing one sheet. */
          #slip-print-root {
            display: block !important;
            position: static !important;
            left: auto !important;
            top: auto !important;
            margin: 0 !important;
            padding: 0 !important;
          }

          /* One sheet per physical label. The break is between sheets, never
             between the slips on one, so four roll slips share a piece of
             stock — and break-inside on the sheet is what holds that 2x2
             block together as a single unbreakable box. */
          #slip-print-root > .slip-sheet {
            break-inside: avoid;
            page-break-inside: avoid;
            break-after: page;
            page-break-after: always;
          }
          /* The last sheet must not emit a trailing blank label, which would
             waste a piece of stock on every single print. */
          #slip-print-root > .slip-sheet:last-child {
            break-after: auto;
            page-break-after: auto;
          }
          /* A slip must never be split across two labels either. */
          #slip-print-root .box-slip,
          #slip-print-root .roll-slip {
            break-inside: avoid;
            page-break-inside: avoid;
          }

          /* Solid fills and reversed text are the whole design here; without
             this browsers helpfully drop them to save ink. */
          #slip-print-root * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      `,
        }}
      />
    </div>
  );
}
