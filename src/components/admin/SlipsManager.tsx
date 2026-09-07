'use client';
// src/components/admin/SlipsManager.tsx
// ============================================================
// Every slip Dispatch prints — pick a job once, print any of them.
// Replaces retyping five BarTender templates for every consignment.
// ============================================================
//
// WHY ONE PAGE FOR FIVE SLIPS
// Dispatch prints several for the same consignment, off the same job. Separate
// pages would mean searching for that job once per slip and re-entering the
// date each time, so the job and the date are held here and the tab only swaps
// the fields that genuinely differ. The address slip is the exception that
// proves it: it is the only tab with no job field, so it is the only one that
// works before a job is picked.
//
// HOW PRINTING WORKS HERE
// No print server, no local agent, and no record. Slips render into
// #slip-print-root, the @media print block hides everything else, and
// window.print() hands the result to the TSC P210's ordinary Windows driver.
// Nothing is written to the database and nothing is read back: a slip
// describes a carton or roll about to be packed, and the job already holds
// everything about it worth keeping.
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
//     page breaks inside one. That is what broke sheet ganging: the roll
//     slips meant to share a sheet came out on separate labels each.
//
// As a body-level child in normal flow, each .slip-sheet is an ordinary
// block that `break-after: page` can act on, which is all this needs.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { Printer, Search } from 'lucide-react';
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
  ROLL_SLIP_ROWS,
  type RollSlipLabelData,
} from './RollSlipLabel';
import RollSlipCompactLabel, {
  compactSlipGeometry,
  type CompactSlipVariant,
  type RollSlipCompactLabelData,
} from './RollSlipCompactLabel';
import AddressSlipLabel, {
  ADDRESS_SLIP_WIDTH_MM,
  ADDRESS_SLIP_HEIGHT_MM,
  DEFAULT_FROM_ADDRESS,
  NO_OFFSET,
  type AddressBlock,
  type BlockOffset,
  type AddressSlipLabelData,
} from './AddressSlipLabel';
import type { Job } from '@/lib/types';

/**
 * The five artworks this page can put on a sheet.
 *
 * 'roll', 'roll10' and 'roll12' are the same slip at three densities — the
 * fields and the validation are shared, and only the tile size and the
 * artwork differ. See ROLL_KINDS below.
 */
type SlipKind = 'box' | 'roll' | 'roll10' | 'roll12' | 'address';

/**
 * The roll-slip family, in the order the tabs show them.
 *
 * Everything that reads "is this a roll slip" goes through isRollKind rather
 * than testing `kind === 'roll'`, so adding a fourth density later is one
 * line here plus a geometry entry — not a hunt through the file.
 */
const ROLL_KINDS = ['roll', 'roll10', 'roll12'] as const;
type RollKind = (typeof ROLL_KINDS)[number];
const isRollKind = (k: SlipKind): k is RollKind =>
  (ROLL_KINDS as readonly string[]).includes(k);

/** Which compact artwork a roll kind prints; 'roll' is the 6-up with the QR. */
const COMPACT_VARIANT: Record<RollKind, CompactSlipVariant | null> = {
  roll: null,
  roll10: 'small',
  roll12: 'mini',
};

const SMALL = compactSlipGeometry('small');
const MINI = compactSlipGeometry('mini');

/**
 * The one media loaded in the P210: 6" x 4". Every slip prints on it, so the
 * printed page is always this size. What changes per tab is only how finely
 * that sheet is tiled — 1, 6, 10 or 12 up.
 */
const SHEET = { w: BOX_SLIP_WIDTH_MM, h: BOX_SLIP_HEIGHT_MM };

/**
 * How one sheet is divided, per tab. One table, because the preview, the
 * print surface, the tab badge and the sheet-count arithmetic must never
 * disagree about what comes off a piece of stock.
 *
 * The rows are declared explicitly rather than left to gridAutoRows. Five or
 * six fixed tracks inside a 101.6mm `overflow: hidden` sheet leave a fraction
 * of a millimetre spare, and naming the tracks keeps that slack at the bottom
 * edge instead of letting a browser distribute it and nudge the last row into
 * the clip.
 */
const TILING: Record<SlipKind, { w: number; h: number; cols: number; rows: number }> = {
  box:     { w: BOX_SLIP_WIDTH_MM,  h: BOX_SLIP_HEIGHT_MM,  cols: 1, rows: 1 },
  roll:    { w: ROLL_SLIP_WIDTH_MM, h: ROLL_SLIP_HEIGHT_MM, cols: ROLL_SLIP_COLUMNS, rows: ROLL_SLIP_ROWS },
  roll10:  { w: SMALL.widthMm,      h: SMALL.heightMm,      cols: SMALL.columns,     rows: SMALL.rows },
  roll12:  { w: MINI.widthMm,       h: MINI.heightMm,       cols: MINI.columns,      rows: MINI.rows },
  address: { w: ADDRESS_SLIP_WIDTH_MM, h: ADDRESS_SLIP_HEIGHT_MM, cols: 1, rows: 1 },
};

/** How much of a sheet one slip occupies — used for the on-screen preview. */
const SLIP_SIZE: Record<SlipKind, { w: number; h: number }> = {
  box:     { w: TILING.box.w,     h: TILING.box.h },
  roll:    { w: TILING.roll.w,    h: TILING.roll.h },
  roll10:  { w: TILING.roll10.w,  h: TILING.roll10.h },
  roll12:  { w: TILING.roll12.w,  h: TILING.roll12.h },
  address: { w: TILING.address.w, h: TILING.address.h },
};

const PER_SHEET: Record<SlipKind, number> = {
  box: 1,
  roll: ROLL_SLIPS_PER_SHEET,
  roll10: SMALL.perSheet,
  roll12: MINI.perSheet,
  address: 1,
};

/** The CSS grid for one sheet of a given kind. */
function sheetGrid(k: SlipKind) {
  const t = TILING[k];
  return {
    gridTemplateColumns: `repeat(${t.cols}, ${t.w}mm)`,
    gridTemplateRows: `repeat(${t.rows}, ${t.h}mm)`,
  };
}

/** What one slip of each kind is called in a message to the operator. */
const SLIP_NOUN: Record<SlipKind, string> = {
  box: 'box slip',
  roll: 'roll slip',
  roll10: 'roll slip',
  roll12: 'roll slip',
  address: 'address slip',
};

/** The tab strip, and the badge under each label. */
const TABS: { kind: SlipKind; label: string }[] = [
  { kind: 'box',     label: 'Box slip' },
  { kind: 'roll',    label: 'Roll slip' },
  { kind: 'roll10',  label: 'Roll slip small' },
  { kind: 'roll12',  label: 'Roll slip mini' },
  { kind: 'address', label: 'Address slip' },
];

/**
 * CSS pixels per millimetre.
 *
 * Fixed at 96dpi because that is what a CSS `mm` is defined as, regardless of
 * the physical monitor: the preview renders at true physical size by that
 * definition, so a drag of N pixels is N/PX_PER_MM millimetres on the label.
 * Nothing here scales the preview, so there is no zoom factor to divide out —
 * if one is ever added, it belongs in this conversion and nowhere else.
 */
const PX_PER_MM = 96 / 25.4;

/**
 * How far a block may be nudged from where the artwork puts it.
 *
 * Generous but not unbounded. The point of a limit is that a block dragged
 * off the sheet is clipped by the label's `overflow: hidden` and simply
 * vanishes — silently, and only discovered on the printed label. Clamping
 * keeps every position recoverable by dragging back.
 */
const OFFSET_LIMIT_MM = { x: 60, y: 45 };

const clampOffset = (o: BlockOffset): BlockOffset => ({
  x: Math.max(-OFFSET_LIMIT_MM.x, Math.min(OFFSET_LIMIT_MM.x, o.x)),
  y: Math.max(-OFFSET_LIMIT_MM.y, Math.min(OFFSET_LIMIT_MM.y, o.y)),
});

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
  | { kind: 'box';     data: BoxSlipLabelData;         copies: number; token: number }
  | { kind: 'roll';    data: RollSlipLabelData;        copies: number; token: number }
  | { kind: 'roll10' | 'roll12';
      data: RollSlipCompactLabelData;                  copies: number; token: number }
  | { kind: 'address'; data: AddressSlipLabelData;     copies: number; token: number };

/**
 * The millimetre offset of one address block, as two typed fields.
 *
 * The drag in the preview is the primary control and this is its readout —
 * but it is a writable readout, because "3mm left" is faster to type than to
 * find by hand, and because a dragged position is otherwise impossible to
 * reproduce on the next consignment. Right and down are positive, matching
 * the direction the block visibly moves and the sign of the CSS translate
 * behind it.
 *
 * WHY THESE ARE type="text" AND NOT type="number"
 * A number input reports `value === ""` while it holds a lone "-", and
 * `Number("")` is 0 rather than NaN — so the obvious `Number.isFinite` guard
 * accepts it, writes 0, and React re-renders the field, wiping out the minus
 * before the digits are typed. The offset then silently comes out positive.
 * Left and up are half of what this control is for, so the field keeps its
 * own text and only commits when that text actually parses.
 *
 * The spinner lost with type="number" comes back as ArrowUp/ArrowDown below,
 * which is the better nudge anyway: it works without the pointer leaving the
 * keyboard, and it is how the block gets moved a precise half-millimetre.
 */
function BlockNudge({
  label,
  offset,
  onChange,
}: {
  label: string;
  offset: BlockOffset;
  onChange: (o: BlockOffset) => void;
}) {
  const fmt = (n: number) => String(Number(n.toFixed(1)));
  const [text, setText] = useState({ x: fmt(offset.x), y: fmt(offset.y) });

  // Adopt an offset that changed elsewhere — a drag, or Reset positions.
  // A value committed by typing round-trips to the identical string, so this
  // cannot fight the operator mid-edit: "−8." commits −8, the offset is
  // already −8, these deps do not change, and the trailing dot survives.
  useEffect(() => {
    setText({ x: fmt(offset.x), y: fmt(offset.y) });
  }, [offset.x, offset.y]);

  const edit = (axis: 'x' | 'y') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setText((t) => ({ ...t, [axis]: raw }));
    // "", "-", "." and "-." are all midway through typing a real number.
    // Committing them would overwrite the field under the cursor.
    if (/^-?\.?$/.test(raw.trim())) return;
    const n = Number(raw);
    if (Number.isFinite(n)) onChange({ ...offset, [axis]: n });
  };

  /**
   * On the way out, show what was actually applied.
   *
   * The sync effect above cannot do this on its own: a value the parent
   * clamps does not change the offset, so typing "99" and then "999" both
   * land on the 60mm limit, the deps never change, and the field would go on
   * claiming 999 while the block sits at 60. Leaving the field is the moment
   * the operator is done typing, so it is the right moment to replace what
   * they typed with the truth — that also tidies a stray "-" or a trailing
   * dot left behind mid-edit.
   */
  const settle = () => setText({ x: fmt(offset.x), y: fmt(offset.y) });

  const nudge = (axis: 'x' | 'y') => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const step = (e.shiftKey ? 5 : 0.5) * (e.key === 'ArrowUp' ? 1 : -1);
    onChange({ ...offset, [axis]: Number((offset[axis] + step).toFixed(1)) });
  };

  const field =
    'w-16 min-h-11 px-2 rounded-lg text-xs text-center tabular-nums ' +
    'bg-[var(--field-bg)] border border-[var(--field-border)] text-[var(--glass-ink)] ' +
    'focus:outline-none focus:border-emerald-300/70 transition-colors';

  const axisField = (axis: 'x' | 'y', described: string) => (
    <>
      <label className="sr-only" htmlFor={`nudge-${label}-${axis}`}>
        {label} block, millimetres {described}
      </label>
      <input
        id={`nudge-${label}-${axis}`}
        type="text"
        inputMode="decimal"
        value={text[axis]}
        onChange={edit(axis)}
        onBlur={settle}
        onKeyDown={nudge(axis)}
        className={field}
      />
    </>
  );

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs font-medium text-[var(--glass-muted)]">{label}</span>
      {axisField('x', 'right')}
      <span aria-hidden="true" className="text-xs text-[var(--glass-muted)]">×</span>
      {axisField('y', 'down')}
      <span className="text-xs text-[var(--glass-muted)]">mm</span>
    </div>
  );
}

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

  // ── Address-slip fields ─────────────────────────────────────
  // The sender starts filled and the destination starts empty: one of them is
  // the same on every consignment ever packed, the other is the only thing
  // this slip actually says.
  const [toAddress, setToAddress] = useState('');
  const [fromAddress, setFromAddress] = useState(DEFAULT_FROM_ADDRESS);
  const [addressCount, setAddressCount] = useState('1');

  // Where each block sits relative to the artwork. Not persisted: how much
  // room an address needs is a property of that address, so the next
  // consignment starts from the default rather than inheriting a nudge that
  // suited the last one.
  const [toOffset, setToOffset] = useState<BlockOffset>(NO_OFFSET);
  const [fromOffset, setFromOffset] = useState<BlockOffset>(NO_OFFSET);

  const [printReq, setPrintReq] = useState<PrintRequest | null>(null);
  const printToken = useRef(0);

  // Resolved after mount: document.body does not exist during SSR, and the
  // print surface must hang off it rather than off this component's subtree.
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  useEffect(() => setPortalTarget(document.body), []);

  // The three roll densities share one permission: they are the same slip.
  // The address slip is a dispatch action rather than a production record, so
  // anyone already trusted to print for a consignment may print one — which
  // avoids seeding a new department feature key for a label carrying nothing
  // the job does not already expose.
  const canPrint =
    kind === 'box' ? canPrintBox
    : kind === 'address' ? (canPrintBox || canPrintRoll)
    : canPrintRoll;

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
    // Only the party name, and only into an empty box: it is the one line of
    // a postal address the app actually knows, and overwriting an address
    // already typed would lose work on a tab the operator may not be looking
    // at. The rest of the address is theirs to type.
    setToAddress((prev) => (prev.trim() ? prev : j.party));
  }

  // ── Validation ──────────────────────────────────────────────
  const boxQty = Number(qtyPerBox);
  const boxes = Number(boxCount);
  const rollQty = Number(qtyPerRoll);
  const rolls = Number(rollCount);

  const addresses = Number(addressCount);

  const problem = useMemo(() => {
    // The address slip is the one tab that stands alone: it carries no job
    // field, so requiring a job would block the common case of addressing a
    // carton that is already packed and off the worksheet.
    if (kind === 'address') {
      if (!toAddress.trim()) return 'A To address is required';
      if (!fromAddress.trim()) return 'A From address is required';
      if (!Number.isInteger(addresses) || addresses <= 0) return 'Number of slips must be a whole number';
      if (addresses > 50) return 'That would print more than 50 slips';
      return null;
    }
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
  }, [job, date, kind, materialName, boxQty, boxes, product, rollQty, rolls,
      toAddress, fromAddress, addresses]);

  const boxPreview: BoxSlipLabelData = {
    materialName: materialName.trim() || 'MATERIAL NAME',
    pmCode: job?.pm_code ?? null,
    qtyPerBox: Number.isFinite(boxQty) && boxQty > 0 ? boxQty : 0,
    boxCount: Number.isFinite(boxes) && boxes > 0 ? boxes : 1,
    mfgDate: date,
  };

  const compactPreview: RollSlipCompactLabelData = {
    product: product.trim() || 'PRODUCT',
    pmCode: job?.pm_code ?? null,
    qtyPerRoll: Number.isFinite(rollQty) && rollQty > 0 ? rollQty : 0,
    direction: direction.trim() || null,
    operator: operator.trim() || null,
    slipDate: date,
  };

  const addressPreview: AddressSlipLabelData = {
    toAddress: toAddress.trim() || 'CONSIGNEE NAME\nStreet, City\nState  PIN',
    fromAddress: fromAddress.trim() || DEFAULT_FROM_ADDRESS,
    toOffset,
    fromOffset,
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

  /**
   * Drag one address block around the preview.
   *
   * Pointer events rather than mouse events, so a finger on the packing-bench
   * tablet works the same as a mouse. setPointerCapture is what makes the
   * drag survive the pointer leaving the block — without it, moving faster
   * than React re-renders drops the gesture the moment the cursor outruns the
   * text, which feels like the block sticking.
   *
   * The offset at pointer-down is the baseline; every move is measured from
   * the original press rather than accumulated frame to frame, so rounding
   * cannot drift over a long drag.
   */
  function handleBlockPointerDown(block: AddressBlock, e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    el.style.cursor = 'grabbing';

    const startX = e.clientX;
    const startY = e.clientY;
    const base = block === 'to' ? toOffset : fromOffset;
    const set = block === 'to' ? setToOffset : setFromOffset;

    const onMove = (ev: PointerEvent) => {
      set(clampOffset({
        x: base.x + (ev.clientX - startX) / PX_PER_MM,
        y: base.y + (ev.clientY - startY) / PX_PER_MM,
      }));
    };
    const onUp = () => {
      el.style.cursor = 'grab';
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  }

  /**
   * One rendered slip of a given kind. The preview and the print surface both
   * go through this, so a tab can never look one way on screen and print
   * another.
   *
   * `interactive` is the single exception, and it adds nothing to the page —
   * it only hands the address slip a drag handler, which turns on a cursor
   * and a dashed outline that exist on screen and never print. Geometry is
   * identical either way.
   */
  function renderSlip(k: SlipKind, data: PrintRequest['data'], key: number, interactive = false) {
    if (k === 'box') return <BoxSlipLabel key={key} data={data as BoxSlipLabelData} />;
    if (k === 'roll') return <RollSlipLabel key={key} data={data as RollSlipLabelData} />;
    if (k === 'address') return (
      <AddressSlipLabel
        key={key}
        data={data as AddressSlipLabelData}
        onBlockPointerDown={interactive ? handleBlockPointerDown : undefined}
      />
    );
    return (
      <RollSlipCompactLabel
        key={key}
        variant={COMPACT_VARIANT[k as RollKind]!}
        data={data as RollSlipCompactLabelData}
      />
    );
  }

  /** What the open tab would print right now, before the server sees it. */
  const preview: PrintRequest['data'] =
    kind === 'box' ? boxPreview
    : kind === 'roll' ? rollPreview
    : kind === 'address' ? addressPreview
    : compactPreview;

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

  /**
   * Print the batch.
   *
   * Nothing is recorded. Slips were once POSTed to a pair of API routes that
   * wrote a batch row, so a past print could be reprinted from a list; the
   * list, the routes and the two tables are all gone — see migration 054.
   * A slip describes a carton or a roll about to be packed, and the job
   * itself already holds everything worth keeping, so the print goes
   * straight to the printer and leaves nothing behind.
   *
   * That makes this synchronous: no await, no failure mode, no "could not
   * reach the server" on a flaky shop-floor link when the printer is sitting
   * right there.
   */
  function handlePrint() {
    if (problem) { toast.error(problem); return; }
    firePrint({ kind, data: preview, copies } as Omit<PrintRequest, 'token'>);
    toast.success(
      `${copies} ${SLIP_NOUN[kind]}${copies > 1 ? 's' : ''} sent to the printer`,
    );
  }

  /** A single slip, for lining the stock up in the printer before a run. */
  function handleTestPrint() {
    if (kind === 'address') {
      if (!toAddress.trim()) { toast.error('Enter a To address first'); return; }
    } else if (kind === 'box') {
      if (!Number.isInteger(boxQty) || boxQty <= 0) { toast.error('Enter a quantity per box first'); return; }
    } else if (!Number.isInteger(rollQty) || rollQty <= 0) {
      toast.error('Enter a quantity per roll first'); return;
    }
    firePrint({ kind, data: preview, copies: 1 } as Omit<PrintRequest, 'token'>);
  }

  const copies = kind === 'box' ? boxes : kind === 'address' ? addresses : rolls;
  const unit = kind === 'box' ? 'box' : kind === 'address' ? 'slip' : 'roll';

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
        className="inline-flex flex-wrap rounded-xl border border-[var(--field-border)] p-1 gap-1"
      >
        {TABS.map(({ kind: k, label }) => (
          <button
            key={k}
            role="tab"
            aria-selected={kind === k}
            onClick={() => setKind(k)}
            className={cn(
              'min-h-9 px-3 rounded-lg text-sm font-medium transition-colors',
              kind === k
                ? 'bg-brand-primary text-white'
                : 'text-[var(--glass-muted)] hover:bg-black/[0.04]',
            )}
          >
            {label}
            <span className="ml-1.5 text-xs opacity-70">
              {/* What the operator loads and cuts, not the artwork size. Every
                  tab prints on the same 6x4 stock; the number is how many come
                  off one piece of it. */}
              {PER_SHEET[k] === 1 ? '6″ × 4″' : `${PER_SHEET[k]} per 6″ × 4″`}
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

      {!job && kind !== 'address' && (
        <p className="text-sm text-[var(--glass-muted)]">
          Pick a job and its party, product and PM code fill themselves in.
          You only enter what the app cannot know.
        </p>
      )}

      {/* The address slip needs no job — see the validation in `problem`. */}
      {(job || kind === 'address') && (
        <>
          <div className="rounded-2xl border border-[var(--field-border)] p-4 space-y-3">
            {job && (
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium text-[var(--glass-ink)]">
                {job.party}
                <span className="text-[var(--glass-muted)] font-normal">
                  {' '}· PO {job.po_number}{job.pm_code ? ` · PM ${job.pm_code}` : ''}
                </span>
              </p>
              <button
                type="button"
                onClick={() => setJob(null)}
                className="text-xs text-[var(--glass-muted)] underline underline-offset-2 hover:opacity-70"
              >
                Change job
              </button>
            </div>
            )}

            {kind === 'address' ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={LABEL_CLS} htmlFor="s-to">To address</label>
                    <textarea
                      id="s-to"
                      rows={7}
                      value={toAddress}
                      onChange={(e) => setToAddress(e.target.value)}
                      placeholder={'CONSIGNEE NAME PVT LTD\nB-31, Sector 85,\nNoida, Gautam Budh Nagar\nUttar Pradesh\n201305'}
                      className={cn(FIELD, 'py-2 leading-relaxed resize-y')}
                    />
                  </div>
                  <div>
                    <label className={LABEL_CLS} htmlFor="s-from">From address</label>
                    <textarea
                      id="s-from"
                      rows={7}
                      value={fromAddress}
                      onChange={(e) => setFromAddress(e.target.value)}
                      className={cn(FIELD, 'py-2 leading-relaxed resize-y')}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className={LABEL_CLS} htmlFor="s-addresses">Number of slips</label>
                    <input id="s-addresses" type="number" inputMode="numeric" min={1}
                      value={addressCount} onChange={(e) => setAddressCount(e.target.value)}
                      className={FIELD} />
                  </div>
                </div>
                <p className="text-xs text-[var(--glass-muted)]">
                  Line breaks print exactly as typed. The From address is
                  pre-filled and only needs changing for a one-off.
                </p>
              </>
            ) : kind === 'box' ? (
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
                ? isRollKind(kind)
                  ? `${copies} slip${copies > 1 ? 's' : ''} — one per roll, ${PER_SHEET[kind]} to a 6″ × 4″ sheet, so ${sheets} sheet${sheets > 1 ? 's' : ''} of stock.`
                  : kind === 'address'
                    ? `${copies} identical slip${copies > 1 ? 's' : ''} will print — ${sheets} sheet${sheets > 1 ? 's' : ''} of stock.`
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
                seeing the tiling, and seeing the blanks on a short sheet. */}
            <div className="overflow-x-auto rounded-2xl border border-[var(--field-border)] bg-[#EEF1F5] p-4">
              <div
                className="shadow-sm rounded-[3mm] overflow-hidden mx-auto bg-white"
                style={{
                  width: `${SHEET.w}mm`,
                  height: `${SHEET.h}mm`,
                  display: 'grid',
                  ...sheetGrid(kind),
                }}
              >
                {Array.from(
                  { length: Math.min(copies > 0 ? copies : 1, PER_SHEET[kind]) },
                  (_, i) => renderSlip(kind, preview, i, true),
                )}
              </div>
            </div>
            {kind === 'roll' && (
              <p className="mt-2 text-xs text-[var(--glass-muted)]">
                Six to a sheet, cut apart along the borders. The QR opens this
                job&rsquo;s live tracking page for the client.
              </p>
            )}
            {(kind === 'roll10' || kind === 'roll12') && (
              <p className="mt-2 text-xs text-[var(--glass-muted)]">
                {PER_SHEET[kind]} to a sheet, cut apart along the borders. Too
                small to carry the tracking QR — use the 6-up roll slip when
                the client needs to scan it. A product name longer than the
                row is cut off with an ellipsis rather than wrapped.
              </p>
            )}
            {kind === 'address' && (
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                <p className="text-xs text-[var(--glass-muted)]">
                  One to a sheet, no cutting. Drag either block in the preview
                  to reposition it, or type an exact offset.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <BlockNudge
                    label="To"
                    offset={toOffset}
                    onChange={(o) => setToOffset(clampOffset(o))}
                  />
                  <BlockNudge
                    label="From"
                    offset={fromOffset}
                    onChange={(o) => setFromOffset(clampOffset(o))}
                  />
                  {(toOffset.x || toOffset.y || fromOffset.x || fromOffset.y) ? (
                    <button
                      type="button"
                      onClick={() => { setToOffset(NO_OFFSET); setFromOffset(NO_OFFSET); }}
                      className="min-h-11 px-2 text-xs text-[var(--glass-muted)] underline underline-offset-2 hover:opacity-70"
                    >
                      Reset positions
                    </button>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          {/* ── Actions ────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              intent="primary"
              icon={Printer}
              disabled={!canPrint || !!problem}
              onClick={handlePrint}
              title={problem ?? undefined}
            >
              Print {Number.isInteger(copies) && copies > 1 ? `${copies} slips` : 'slip'}
            </Button>
            <Button intent="ghost" onClick={handleTestPrint}>
              Print one to test
            </Button>
            {!canPrint && (
              <p className="text-xs text-[var(--glass-muted)]">
                Your department can view slips but not print them.
              </p>
            )}
          </div>
        </>
      )}

      {/* ── The surface that actually prints ─────────────────── */}
      {/* One .slip-sheet per physical 6"x4" label. A box or address slip
          fills its sheet; roll slips gang 6, 10 or 12 to one, so the last
          sheet of an uneven run is simply short — 7 rolls on the 6-up is a
          full sheet plus a sheet holding one, the other five cells blank. */}
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
                    // Roll slips tile 2 across; box and address fill the sheet.
                    ...sheetGrid(printReq.kind),
                  }}
                >
                  {sheet.map((slipIndex) =>
                    renderSlip(printReq.kind, printReq.data, slipIndex),
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
             stopped the roll slips sharing one sheet. */
          #slip-print-root {
            display: block !important;
            position: static !important;
            left: auto !important;
            top: auto !important;
            margin: 0 !important;
            padding: 0 !important;
          }

          /* One sheet per physical label. The break is between sheets, never
             between the slips on one, so six roll slips share a piece of
             stock — and break-inside on the sheet is what holds that 2x3
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
          #slip-print-root .address-slip,
          #slip-print-root .roll-slip-compact,
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
