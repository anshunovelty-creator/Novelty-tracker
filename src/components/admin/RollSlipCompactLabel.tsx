// src/components/admin/RollSlipCompactLabel.tsx
// ============================================================
// The two compact roll slips — BarTender's "ROLL SLIP SMALL NEW 4 X 6
// INCH.btw" (76.2 x 20.3 mm, ten to a sheet) and "ROLL SMALL SLIP 2 X 3
// MM.btw" (76.2 x 16.9 mm, twelve to a sheet).
// ============================================================
//
// WHY ONE COMPONENT FOR BOTH
// They are the same four-row table — DATE/SUPPLIER, PRODUCT, PM CODE +
// DIRECTION, QUANTITY + OPERATOR. Only the height, the type scale and the
// reversed supplier bar differ, and all three live in VARIANTS below. Two
// near-identical files would drift the moment one of them was corrected.
//
// HOW THE HEIGHTS WERE CHOSEN
// They were not chosen; they are BarTender's own item heights, and they are
// the numbers that make the sheet divide evenly:
//
//   20.3 x 5 = 101.5   (0.1 mm under the 101.6 mm sheet)
//   16.9 x 6 = 101.4   (0.2 mm under)
//
// Both leave a sliver of slack at the bottom edge on purpose. Five or six
// stacked fixed tracks inside an `overflow: hidden` sheet is exactly the
// arrangement where a browser's sub-pixel rounding clips the last row, and a
// tenth of a millimetre of dead space is invisible on the cut line.
//
// WHY THE ROWS ARE GRID TRACKS AND NOT MEASURED
// RollSlipLabel spends its vertical budget in hand-computed millimetres,
// which works but has to be re-derived every time anything moves. Here the
// table is a four-track grid of `1fr`, so the rows split whatever the content
// box turns out to be into exact quarters. Change the slip height and the
// rows follow; only the type sizes need a second look.
//
// It has to be grid and not `flex: 1 1 0`, which is the obvious way to write
// this and is subtly wrong. Flex hands out the *free* space, and a row's rule
// is not free space: it is subtracted first, then the remainder is split. The
// three ruled rows therefore each kept a rule's worth of height that the
// unruled fourth never got, and the bottom row of the 12-up measured 3.49mm
// against its siblings' 3.76mm — 7% short, on the row carrying the quantity.
// Nothing overflowed, so nothing looked wrong; the slip was just lopsided.
// A grid track contains its item's border, so `1fr` divides evenly.
//
// Measured after the change, on the 12-up: 3.692 / 3.692 / 3.692 / 3.696 mm,
// summing to the table's 14.77mm content box. That box is 14.77 and not the
// 14.5 the millimetre arithmetic predicts because Chrome rounds each 0.4mm
// rule down to one CSS pixel (0.265mm) for layout. Measure the rendered box
// before concluding a row does not fit — the nominal numbers will lie.
//
// WHAT IS DELIBERATELY MISSING
// No QR. The 6-up slip carries one because it has a 16 mm row to put it in;
// at 20.3 mm tall, and 16.9 mm tall, there is no size at which a QR would
// still scan. A client who needs the tracking link gets it from the 6-up
// slip, the dispatch email or the WhatsApp message.

import type { CSSProperties } from 'react';

/** Which of the two compact slips to print. */
export type CompactSlipVariant = 'small' | 'mini';

export type RollSlipCompactLabelData = {
  product: string;
  pmCode: string | null;
  qtyPerRoll: number;
  direction: string | null;
  operator: string | null;
  /** ISO 'YYYY-MM-DD'. */
  slipDate: string;
};

/**
 * Everything that separates the two slips.
 *
 * `reverseSupplier` is not a design choice made here — it reproduces the
 * artwork. The 12-up original fills its supplier cell solid black with
 * knocked-out text and the 10-up original does not, and operators pick the
 * right slip off a bench by that bar. Unify them only on request.
 */
const VARIANTS = {
  small: {
    heightMm: 20.3,
    perSheet: 10,
    rows: 5,
    padMm: 1.0,
    col1Mm: 23,
    col2Mm: 21,
    reverseSupplier: false,
    fs: { label: 2.9, date: 2.5, supplier: 2.9, value: 2.9, meta: 2.5 },
  },
  mini: {
    heightMm: 16.9,
    perSheet: 12,
    rows: 6,
    padMm: 0.8,
    col1Mm: 23,
    col2Mm: 21,
    reverseSupplier: true,
    fs: { label: 2.5, date: 2.2, supplier: 2.5, value: 2.5, meta: 2.2 },
  },
} as const;

/** Both slips are the full half-width of the sheet; only height varies. */
export const COMPACT_SLIP_WIDTH_MM = 76.2;
export const COMPACT_SLIP_COLUMNS = 2;

/** Sheet geometry for a variant, for SlipsManager's grid and its copy. */
export function compactSlipGeometry(variant: CompactSlipVariant) {
  const v = VARIANTS[variant];
  return {
    widthMm: COMPACT_SLIP_WIDTH_MM,
    heightMm: v.heightMm,
    columns: COMPACT_SLIP_COLUMNS,
    rows: v.rows,
    perSheet: v.perSheet,
  };
}

const BORDER_MM = 0.4; // 0.4mm ≈ 3 dots at 203 dpi, same rule weight as the 6-up
const RULE = `${BORDER_MM}mm solid #000`;

/** ISO date → DD-MM-YYYY by string surgery — see BoxSlipLabel for why not Date. */
function formatSlipDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}-${m}-${y}`;
}

/** Shared cell chrome. Every cell is a single unwrapped line that ellipses. */
const cell = (extra: CSSProperties = {}): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0 0.6mm',
  boxSizing: 'border-box',
  overflow: 'hidden',
  ...extra,
});

/**
 * One line of text that never wraps.
 *
 * A compact row is a single line tall, so a wrap would not overflow visibly —
 * it would push the second line under the rule and print a slip that silently
 * lost half its product name. Clipping to an ellipsis at least shows the
 * operator that the text was too long.
 */
const line = (sizeMm: number, extra: CSSProperties = {}): CSSProperties => ({
  fontSize: `${sizeMm}mm`,
  fontWeight: 700,
  lineHeight: 1.05,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  ...extra,
});

/** A row of the table: one 1fr grid track, its rule included. */
const row = (last: boolean): CSSProperties => ({
  display: 'flex',
  minHeight: 0,
  ...(last ? {} : { borderBottom: RULE }),
});

export default function RollSlipCompactLabel({
  variant,
  data,
}: {
  variant: CompactSlipVariant;
  data: RollSlipCompactLabelData;
}) {
  const v = VARIANTS[variant];
  const { product, pmCode, qtyPerRoll, direction, operator, slipDate } = data;

  const labelCell = cell({ width: `${v.col1Mm}mm`, flex: '0 0 auto', borderRight: RULE });
  const valueCell = cell({
    width: `${v.col2Mm}mm`,
    flex: '0 0 auto',
    borderRight: RULE,
    justifyContent: 'flex-start',
  });
  const metaCell = cell({ flex: '1 1 auto', minWidth: 0, justifyContent: 'flex-start' });

  return (
    <div
      className="roll-slip-compact"
      style={{
        width: `${COMPACT_SLIP_WIDTH_MM}mm`,
        height: `${v.heightMm}mm`,
        boxSizing: 'border-box',
        padding: `${v.padMm}mm`,
        background: '#fff',
        color: '#000',
        // System faces, not the app's webfont: a font that fails to load on an
        // offline packing PC would silently reflow every slip on the sheet.
        fontFamily: 'Arial, Helvetica, sans-serif',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          border: RULE,
          boxSizing: 'border-box',
          display: 'grid',
          gridTemplateRows: 'repeat(4, 1fr)',
        }}
      >
        {/* ── Row 1: date, then the house name across the rest ── */}
        <div style={row(false)}>
          <div style={labelCell}>
            <span style={line(v.fs.date)}>DATE :{formatSlipDate(slipDate)}</span>
          </div>
          <div
            style={cell({
              flex: '1 1 auto',
              minWidth: 0,
              // Knocked-out type has to survive Chrome's ink-saving pass; the
              // print stylesheet forces color-adjust, and the cell paints edge
              // to edge so the bar meets the rules rather than floating.
              ...(v.reverseSupplier ? { background: '#000', color: '#fff' } : {}),
            })}
          >
            <span style={line(v.fs.supplier)}>SUPPLIER - NOVELTY CREATIONS</span>
          </div>
        </div>

        {/* ── Row 2: product, spanning everything right of the label ── */}
        <div style={row(false)}>
          <div style={labelCell}>
            <span style={line(v.fs.label)}>PRODUCT</span>
          </div>
          <div style={metaCell}>
            <span style={line(v.fs.value)}>{product}</span>
          </div>
        </div>

        {/* ── Row 3: PM code + winding direction ── */}
        <div style={row(false)}>
          <div style={labelCell}>
            <span style={line(v.fs.label)}>PM CODE</span>
          </div>
          <div style={valueCell}>
            {/* A missing PM code prints an empty cell — never the word "null",
                and never BarTender's literal "<Empty>". */}
            <span style={line(v.fs.value)}>{pmCode ?? ''}</span>
          </div>
          <div style={metaCell}>
            <span style={line(v.fs.meta)}>DIRECTION:{direction ?? ''}</span>
          </div>
        </div>

        {/* ── Row 4: quantity + operator ── */}
        <div style={row(true)}>
          <div style={labelCell}>
            <span style={line(v.fs.label)}>QUANTITY</span>
          </div>
          <div style={valueCell}>
            <span style={line(v.fs.value)}>{qtyPerRoll > 0 ? `${qtyPerRoll} NOS` : ''}</span>
          </div>
          <div style={metaCell}>
            <span style={line(v.fs.meta)}>OPERATOR -{operator ?? ''}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
