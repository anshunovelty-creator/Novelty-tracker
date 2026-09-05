'use client';
// src/components/admin/BoxSlipManager.tsx
// ============================================================
// Box slips — pick a job, fill in what only Dispatch knows, print.
// Replaces retyping the whole slip into BarTender for every consignment.
// ============================================================
//
// HOW PRINTING WORKS HERE
// There is no print server and no local agent. The slips are rendered into
// a hidden #box-slip-print-root, and the @media print block at the bottom of
// this file hides the entire admin shell and promotes that root to the page.
// window.print() then hands it to the TSC P210's ordinary Windows driver.
//
// The root is parked off-screen rather than display:none, because a
// display:none element is not printed at all in any browser. Visibility is
// what the print block toggles, so layout is preserved throughout.

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
import type { BoxSlip, Job } from '@/lib/types';

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
 * every box packed after 05:30 IST — exactly the kind of error nobody spots
 * until a customer queries a shipment.
 */
function todayLocalISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type PrintRequest = {
  data: BoxSlipLabelData;
  copies: number;
  /** Bumped on every request so a repeat print of identical data still fires. */
  token: number;
};

export default function BoxSlipManager({ canPrint }: { canPrint: boolean }) {
  // ── Job selection ───────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Job[]>([]);
  const [searching, setSearching] = useState(false);
  const [job, setJob] = useState<Job | null>(null);

  // ── The slip's variable fields ──────────────────────────────
  const [materialName, setMaterialName] = useState('');
  const [qtyPerBox, setQtyPerBox] = useState('');
  const [boxCount, setBoxCount] = useState('1');
  const [mfgDate, setMfgDate] = useState(todayLocalISO);

  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<BoxSlip[]>([]);
  const [printReq, setPrintReq] = useState<PrintRequest | null>(null);
  const printToken = useRef(0);

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
        // A failed lookup leaves the previous results alone rather than
        // flashing an error toast on every keystroke over a flaky link.
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const loadHistory = useCallback(async (jobId?: string) => {
    try {
      const url = jobId ? `/api/box-slips?job_id=${encodeURIComponent(jobId)}` : '/api/box-slips';
      const res = await fetch(url);
      const data = await res.json();
      if (res.ok) setHistory(data.slips ?? []);
    } catch {
      // History is a convenience — its absence must never block a print.
    }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  function selectJob(j: Job) {
    setJob(j);
    setSearch('');
    setResults([]);
    // Prefill everything the job already knows. The sample slip packs the
    // whole order into one box (3900 X 1 BOX), so that is the default shape:
    // the operator corrects it only when the consignment actually splits.
    setMaterialName(j.job_name ?? '');
    setQtyPerBox(j.label_qty ? String(j.label_qty) : '');
    setBoxCount('1');
    loadHistory(j.id);
  }

  // ── Validation ──────────────────────────────────────────────
  const qty = Number(qtyPerBox);
  const boxes = Number(boxCount);
  const problem = useMemo(() => {
    if (!job) return 'Pick a job first';
    if (!materialName.trim()) return 'Material name is required';
    if (!Number.isInteger(qty) || qty <= 0) return 'Quantity per box must be a whole number';
    if (!Number.isInteger(boxes) || boxes <= 0) return 'Number of boxes must be a whole number';
    if (boxes > 200) return 'That would print more than 200 slips';
    if (!mfgDate) return 'Manufacturing date is required';
    return null;
  }, [job, materialName, qty, boxes, mfgDate]);

  const preview: BoxSlipLabelData = {
    materialName: materialName.trim() || 'MATERIAL NAME',
    pmCode: job?.pm_code ?? null,
    qtyPerBox: Number.isFinite(qty) && qty > 0 ? qty : 0,
    boxCount: Number.isFinite(boxes) && boxes > 0 ? boxes : 1,
    mfgDate,
  };

  // ── Printing ────────────────────────────────────────────────
  // Rendering the copies and calling window.print() cannot happen in the
  // same tick: print() snapshots the DOM synchronously, so it must wait for
  // React to commit. The token in state is what this effect waits on.
  useEffect(() => {
    if (!printReq) return;
    const raf = requestAnimationFrame(() => {
      window.print();
      // Cleared after the dialog closes so the off-screen copies do not
      // linger in the DOM for the rest of the session.
      setPrintReq(null);
    });
    return () => cancelAnimationFrame(raf);
  }, [printReq]);

  function firePrint(data: BoxSlipLabelData, copies: number) {
    printToken.current += 1;
    setPrintReq({ data, copies, token: printToken.current });
  }

  async function handlePrint() {
    if (problem) { toast.error(problem); return; }

    setSaving(true);
    try {
      const res = await fetch('/api/box-slips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: job!.id,
          material_name: materialName.trim(),
          qty_per_box: qty,
          box_count: boxes,
          mfg_date: mfgDate,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Could not record the batch'); return; }

      // Print the recorded values, not the form's — if the server corrected
      // or defaulted anything, the label must match what is on record.
      const slip: BoxSlip = data.slip;
      firePrint(
        {
          materialName: slip.material_name,
          pmCode: slip.pm_code,
          qtyPerBox: slip.qty_per_box,
          boxCount: slip.box_count,
          mfgDate: slip.mfg_date,
        },
        slip.box_count,
      );
      toast.success(`${slip.box_count} slip${slip.box_count > 1 ? 's' : ''} sent to the printer`);
      loadHistory(job!.id);
    } catch {
      toast.error('Could not reach the server');
    } finally {
      setSaving(false);
    }
  }

  /** Prints one slip without recording it — for lining the stock up in the printer. */
  function handleTestPrint() {
    if (!Number.isInteger(qty) || qty <= 0) {
      toast.error('Enter a quantity per box first');
      return;
    }
    firePrint({ ...preview }, 1);
  }

  function reprint(slip: BoxSlip) {
    firePrint(
      {
        materialName: slip.material_name,
        pmCode: slip.pm_code,
        qtyPerBox: slip.qty_per_box,
        boxCount: slip.box_count,
        mfgDate: slip.mfg_date,
      },
      slip.box_count,
    );
  }

  return (
    <div className="space-y-4">
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
          aria-label="Search for a job to print box slips for"
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
          Pick a job and its party, material name and PM code fill themselves in.
          You only enter the box maths and the manufacturing date.
        </p>
      )}

      {job && (
        <>
          {/* ── The four things Dispatch supplies ──────────── */}
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

            <div>
              <label className={LABEL_CLS} htmlFor="bs-material">Material name</label>
              <input
                id="bs-material"
                value={materialName}
                onChange={(e) => setMaterialName(e.target.value)}
                placeholder="STICKER LABEL PET BOTTLE 1 LTR TRACKER"
                className={FIELD}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={LABEL_CLS} htmlFor="bs-qty">Labels per box</label>
                <input
                  id="bs-qty"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={qtyPerBox}
                  onChange={(e) => setQtyPerBox(e.target.value)}
                  className={FIELD}
                />
              </div>
              <div>
                <label className={LABEL_CLS} htmlFor="bs-boxes">Number of boxes</label>
                <input
                  id="bs-boxes"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={boxCount}
                  onChange={(e) => setBoxCount(e.target.value)}
                  className={FIELD}
                />
              </div>
              <div>
                <label className={LABEL_CLS} htmlFor="bs-date">Manufacturing date</label>
                <input
                  id="bs-date"
                  type="date"
                  value={mfgDate}
                  onChange={(e) => setMfgDate(e.target.value)}
                  className={FIELD}
                />
              </div>
            </div>

            <p className="text-xs text-[var(--glass-muted)]">
              {Number.isInteger(boxes) && boxes > 0
                ? `${boxes} identical slip${boxes > 1 ? 's' : ''} will print — one per box.`
                : 'Enter how many boxes to print a slip for each.'}
            </p>
          </div>

          {/* ── Preview, at true physical size ─────────────── */}
          <div>
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <h2 className="text-sm font-medium text-[var(--glass-ink)]">Preview</h2>
              <p className="text-xs text-[var(--glass-muted)]">
                Shown at actual size — 152.4 × 101.6 mm (6″ × 4″)
              </p>
            </div>
            <div className="overflow-x-auto rounded-2xl border border-[var(--field-border)] bg-[#EEF1F5] p-4">
              <div
                className="shadow-sm rounded-[3mm] overflow-hidden mx-auto"
                style={{ width: `${BOX_SLIP_WIDTH_MM}mm`, height: `${BOX_SLIP_HEIGHT_MM}mm` }}
              >
                <BoxSlipLabel data={preview} />
              </div>
            </div>
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
              Print {Number.isInteger(boxes) && boxes > 1 ? `${boxes} slips` : 'slip'}
            </Button>
            <Button intent="ghost" onClick={handleTestPrint} disabled={!Number.isInteger(qty) || qty <= 0}>
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

      {/* ── Recent batches ───────────────────────────────────── */}
      {history.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-[var(--glass-ink)] mb-2">
            {job ? 'Printed for this job' : 'Recently printed'}
          </h2>
          <ul className="divide-y divide-[var(--field-border)] rounded-2xl border border-[var(--field-border)]">
            {history.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm text-[var(--glass-ink)] truncate">
                    {s.material_name}
                  </p>
                  <p className="text-xs text-[var(--glass-muted)]">
                    {s.qty_per_box} × {s.box_count} box · {s.party}
                    {s.pm_code ? ` · PM ${s.pm_code}` : ''}
                  </p>
                </div>
                <Button size="sm" intent="ghost" icon={RotateCcw} onClick={() => reprint(s)}>
                  Reprint
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── The surface that actually prints ─────────────────── */}
      {/* Parked off-screen rather than hidden: a display:none subtree is
          excluded from the printed document entirely. */}
      <div id="box-slip-print-root" aria-hidden="true">
        {printReq &&
          Array.from({ length: printReq.copies }, (_, i) => (
            <BoxSlipLabel key={`${printReq.token}-${i}`} data={printReq.data} />
          ))}
      </div>

      <style>{`
        #box-slip-print-root {
          position: fixed;
          left: -10000px;
          top: 0;
        }

        @media print {
          /* The page IS the label. No margin, or the driver centres a
             152.4mm slip on an A4 sheet and scales it down. */
          @page {
            size: ${BOX_SLIP_WIDTH_MM}mm ${BOX_SLIP_HEIGHT_MM}mm;
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
          #box-slip-print-root,
          #box-slip-print-root * { visibility: visible !important; }

          #box-slip-print-root {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
          }

          /* One slip per label. The last one must not emit a trailing blank
             label, which on a 4x6 roll is a wasted piece of stock every time. */
          #box-slip-print-root > .box-slip {
            break-after: page;
            page-break-after: always;
          }
          #box-slip-print-root > .box-slip:last-child {
            break-after: auto;
            page-break-after: auto;
          }

          /* Solid black fills and reversed text are the whole design here;
             without this browsers helpfully drop them to save ink. */
          #box-slip-print-root * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      `}</style>
    </div>
  );
}
