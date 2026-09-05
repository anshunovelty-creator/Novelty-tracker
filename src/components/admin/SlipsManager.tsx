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
// No print server, no local agent. Slips render into a hidden
// #slip-print-root, and the @media print block at the bottom hides the admin
// shell and promotes that root to the page. window.print() then hands it to
// the TSC P210's ordinary Windows driver.
//
// The root is parked off-screen rather than display:none, because a
// display:none element is not printed at all in any browser.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  type RollSlipLabelData,
} from './RollSlipLabel';
import type { BoxSlip, RollSlip, Job } from '@/lib/types';

type SlipKind = 'box' | 'roll';

const PAGE_SIZE: Record<SlipKind, { w: number; h: number }> = {
  box:  { w: BOX_SLIP_WIDTH_MM,  h: BOX_SLIP_HEIGHT_MM },
  roll: { w: ROLL_SLIP_WIDTH_MM, h: ROLL_SLIP_HEIGHT_MM },
};

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

  // The printed page must be sized for whatever is actually in the print
  // root, which on a reprint may not be the tab currently open.
  const pageKind: SlipKind = printReq?.kind ?? kind;
  const page = PAGE_SIZE[pageKind];

  const copies = kind === 'box' ? boxes : rolls;
  const unit = kind === 'box' ? 'box' : 'roll';
  const history = kind === 'box' ? boxHistory : rollHistory;

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
              {k === 'box' ? '6″ × 4″' : '76 × 32 mm'}
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
              {Number.isInteger(copies) && copies > 0
                ? `${copies} identical slip${copies > 1 ? 's' : ''} will print — one per ${unit}.`
                : `Enter how many ${unit}s to print a slip for each.`}
            </p>
          </div>

          {/* ── Preview, at true physical size ─────────────── */}
          <div>
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <h2 className="text-sm font-medium text-[var(--glass-ink)]">Preview</h2>
              <p className="text-xs text-[var(--glass-muted)]">
                Actual size — {PAGE_SIZE[kind].w} × {PAGE_SIZE[kind].h} mm
              </p>
            </div>
            <div className="overflow-x-auto rounded-2xl border border-[var(--field-border)] bg-[#EEF1F5] p-4">
              <div
                className="shadow-sm rounded-[3mm] overflow-hidden mx-auto"
                style={{ width: `${PAGE_SIZE[kind].w}mm`, height: `${PAGE_SIZE[kind].h}mm` }}
              >
                {kind === 'box'
                  ? <BoxSlipLabel data={boxPreview} />
                  : <RollSlipLabel data={rollPreview} />}
              </div>
            </div>
            {kind === 'roll' && (
              <p className="mt-2 text-xs text-[var(--glass-muted)]">
                The QR opens this job&rsquo;s live tracking page for the client.
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
      <div id="slip-print-root" aria-hidden="true">
        {printReq && Array.from({ length: printReq.copies }, (_, i) =>
          printReq.kind === 'box'
            ? <BoxSlipLabel key={`${printReq.token}-${i}`} data={printReq.data} />
            : <RollSlipLabel key={`${printReq.token}-${i}`} data={printReq.data} />,
        )}
      </div>

      <style>{`
        #slip-print-root {
          position: fixed;
          left: -10000px;
          top: 0;
        }

        @media print {
          /* The page IS the label. No margin, or the driver centres the slip
             on an A4 sheet and scales it down. The size follows whatever is
             in the print root, which on a reprint may not be the open tab. */
          @page {
            size: ${page.w}mm ${page.h}mm;
            margin: 0;
          }

          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
          }

          /* Hide the admin shell by visibility, not display: display:none
             would collapse the layout and take the slip with it. */
          body * { visibility: hidden !important; }
          #slip-print-root,
          #slip-print-root * { visibility: visible !important; }

          #slip-print-root {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
          }

          /* One slip per label. The last must not emit a trailing blank
             label, which is a wasted piece of stock every single print. */
          #slip-print-root > .box-slip,
          #slip-print-root > .roll-slip {
            break-after: page;
            page-break-after: always;
          }
          #slip-print-root > .box-slip:last-child,
          #slip-print-root > .roll-slip:last-child {
            break-after: auto;
            page-break-after: auto;
          }

          /* Solid fills and reversed text are the whole design here; without
             this browsers helpfully drop them to save ink. */
          #slip-print-root * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      `}</style>
    </div>
  );
}
