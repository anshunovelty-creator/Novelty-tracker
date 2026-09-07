// src/components/admin/RollSlipLabel.tsx
// ============================================================
// The roll slip — based on BarTender's "ROLL SLIP 4X6 INCH.btw"
// (whose filename lies: that artwork is 76.2 x 32.2 mm).
// See docs/printing-reference/04-roll-slips/ for the original.
// ============================================================
//
// WHY THIS IS 76.2 x 33.8 mm
// There is one stock loaded in the P210: 6" x 4" (152.4 x 101.6 mm), the
// same media the box slip prints on. The BarTender original put one small
// slip on that sheet and threw the rest away. Six now gang up on one sheet
// as a 2x3 grid: 152.4/2 is exactly 76.2 wide, and 101.6/3 is 33.86 tall,
// taken down to 33.8 so three stacked rows cannot round past the sheet edge
// and lose the bottom pair to the overflow clip.
//
// Width is fixed by the two columns (76.2 x 2 = 152.4 exactly), so the slip
// physically cannot get wider — height is the only dimension six-up can
// spend, and it spends nearly all of it. At 33.8mm the slip is 1.6mm taller
// than the 32.2mm BarTender original, so the vertical budget is back to
// roughly what the artwork was drawn for, and type sizes come back down with
// it. The QR takes the largest single share: 14.5mm, which is 3.1 dots per
// module at 203 dpi for the 37-module code a typical slip encodes — still
// above the ~3.0 floor where small codes start failing to scan, but with
// much less margin than the quarter-sheet layout had.
//
// Sizes are in millimetres rather than Tailwind's rem scale so the print
// cannot drift, and the fonts are system faces because a webfont that fails
// to load on an offline packing PC would silently reflow the label.

import type { CSSProperties } from 'react';
import qrcode from 'qrcode-generator';

/**
 * Physical slip dimensions — one sixth of the 6" x 4" sheet, with the height
 * rounded down off 33.86 so three rows stay inside 101.6mm.
 * SlipsManager lays six of these out per printed page.
 */
export const ROLL_SLIP_WIDTH_MM = 76.2;
export const ROLL_SLIP_HEIGHT_MM = 33.8;

/** How many fit on one 6" x 4" sheet, and how they are arranged. */
export const ROLL_SLIPS_PER_SHEET = 6;
export const ROLL_SLIP_COLUMNS = 2;
export const ROLL_SLIP_ROWS = 3;

/**
 * The deployed app, and so the host of /track — where a scanned QR has to
 * land. Used when NEXT_PUBLIC_APP_URL is not configured for the build.
 *
 * Deliberately the app host and not the marketing domain: /track has to
 * actually resolve, and a QR is printed onto a physical roll that will
 * outlive any redirect set up later. Point this at whatever serves /track.
 */
const FALLBACK_SITE = 'https://novelty-tracker.vercel.app';

export type RollSlipLabelData = {
  product: string;
  pmCode: string | null;
  qtyPerRoll: number;
  direction: string | null;
  operator: string | null;
  /** ISO 'YYYY-MM-DD'. */
  slipDate: string;
  /** Used only to build the QR tracking link — never printed as text. */
  poNumber: string | null;
  party: string;
};

/**
 * The tracking URL behind the QR.
 *
 * Same shape the dispatch emails and WhatsApp messages already use
 * (dispatchEmailTemplate.ts, api/notifications/whatsapp), so a client who
 * scans a roll lands on exactly the page they were emailed.
 *
 * The party is not optional padding. PO numbers are assigned by each client
 * independently, so two customers can genuinely hold the same PO number, and
 * /track/[po] bails out entirely when `partyTerm.length < 2` — a URL without
 * it renders "No Matching Job Found". Without a PO at all we fall back to the
 * plain website, which is what every slip carried before this.
 *
 * WHY ONLY THE FIRST TWO WORDS OF THE PARTY
 * Every character costs QR modules, and QR versions step in cliffs, not
 * gradually. Measured at error-correction M, printed 14.5mm wide at 203 dpi
 * (the six-up size; the old quarter-sheet layout printed these 15mm):
 *
 *   43-62 chars → 33 modules, 3.51 dots per module
 *   63-84 chars → 37 modules, 3.13 dots per module   ← we live here
 *   85+   chars → 41 modules, 2.82 dots per module   ← too thin to trust
 *
 * The middle band is now the last comfortable one, so the truncation below
 * matters more than it did at 15mm, not less.
 *
 * "https://novelty-tracker.vercel.app/track/" is already 41 of those
 * characters, and "?party=" another 7, which leaves roughly 36 for the PO
 * number and party combined before the code drops a density band. A typical
 * slip lands at 68. The full party name would still fit today, but a job
 * with a long PO ("PO/2026/000847-REV-A" encodes to 24 characters) plus a
 * full party name tips over 85 — so the truncation is headroom, bought
 * before it is needed rather than after a batch prints unscannable.
 *
 * It is safe because /track matches the party with a substring ilike
 * (`%term%`), not equality: "ACME BEVERAGES" still resolves "ACME BEVERAGES
 * PVT LTD", and the PO number has to match as well.
 *
 * If /track ever switches to an exact party match, this must send the full
 * name again.
 */
export function buildRollSlipQrUrl(poNumber: string | null, party: string): string {
  // A configured URL is commonly written with a trailing slash; left alone it
  // would produce "…app//track/4521", which still resolves but bloats the QR
  // by a character and looks broken to anyone reading the link.
  const base = (process.env.NEXT_PUBLIC_APP_URL || FALLBACK_SITE).replace(/\/+$/, '');
  if (!poNumber) return base;
  const partyTerm = party.trim().split(/\s+/).slice(0, 2).join(' ');
  return `${base}/track/${encodeURIComponent(poNumber)}?party=${encodeURIComponent(partyTerm)}`;
}

/** ISO date → DD-MM-YYYY by string surgery — see BoxSlipLabel for why not Date. */
function formatSlipDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}-${m}-${y}`;
}

/**
 * QR rendered as SVG rather than a canvas or an image.
 *
 * SVG is resolution-independent, so modules land on exact dot boundaries at
 * whatever dpi the driver rasterises to — a canvas would be resampled and
 * blur the module edges, which is what makes a small QR fail to scan. It is
 * also foreground content, so it prints even if the operator forgets Chrome's
 * "Background graphics" checkbox.
 */
function QrCode({ value, sizeMm }: { value: string; sizeMm: number }) {
  // typeNumber 0 = smallest version that fits the data; error correction M
  // (~15% recovery) is the usual choice for a label that gets handled.
  const qr = qrcode(0, 'M');
  qr.addData(value);
  qr.make();

  const count = qr.getModuleCount();
  const parts: string[] = [];
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) parts.push(`M${col},${row}h1v1h-1z`);
    }
  }

  return (
    <svg
      viewBox={`0 0 ${count} ${count}`}
      style={{ display: 'block', width: `${sizeMm}mm`, height: `${sizeMm}mm` }}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {/* Quiet zone comes from the surrounding cell padding, not from here. */}
      <path d={parts.join('')} fill="#000" />
    </svg>
  );
}

// ── Table geometry ───────────────────────────────────────────
// Widths are unchanged from the original artwork (the slip cannot get wider).
// The heights below are the whole of the six-up budget, spent to the last
// tenth of a millimetre:
//
//   33.8 slip - 3.0 padding (1.5 x 2) = 30.8 inner box
//   30.8 - 0.8 outer border (0.4 x 2) = 30.0 shared by the four rows
//   30.0 = 16.2 (QR row) + 4.6 + 4.6 + 4.6 (the last one implicit, flexed)
//
// globals.css puts everything in `box-sizing: border-box`, so a row height
// here already includes that row's own 0.4mm bottom rule — the QR row is
// 15.8mm of usable space, and the two ruled text rows 4.2mm each. Do not
// subtract the rules a second time.
//
// Change any one of these and the arithmetic has to be redone, because the
// last row is `flex: 1 1 auto` and will silently absorb the error rather
// than overflow — the slip looks fine on screen while the row it stole from
// clips its text.
const PAD_MM = 1.5;            // inset from the sheet gridline to the table
const BORDER_MM = 0.4;         // 0.4mm ≈ 3 dots at 203 dpi
const COL1_MM = 21;            // SUPPLIER / PRODUCT / PM CODE / QUANTITY column
const COL2_MM = 23;            // value column on the PM CODE and QUANTITY rows
const QR_CELL_MM = 17;         // right-hand cell of the top row
const QR_MM = 14.5;            // 3.1 dots per module at 203 dpi, 37 modules
const ROW1_MM = 16.2;          // 15.8 usable: 14.5 of code + 0.65 quiet a side
const ROW2_MM = 4.6;           // 4.2 usable, carrying a 3.2mm face
const ROW34_MM = 4.6;

// Type comes back down with the height. A 4.2mm row carries a 3.0mm face
// with room for its line box; anything larger clips descenders on the first
// browser that rounds line-height up.
const FS_LABEL = 3.0;          // SUPPLIER / PRODUCT / PM CODE / QUANTITY
const FS_VALUE = 3.0;          // PM code, quantity
const FS_PRODUCT = 3.2;
const FS_META = 2.7;           // Direction / Operator — the longest strings
const FS_HOUSE = 4.8;          // NOVELTY CREATIONS, two lines inside ROW1

const RULE = `${BORDER_MM}mm solid #000`;

/** Shared cell chrome: centred content with a little breathing room. */
const cell = (extra: CSSProperties = {}): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0 0.8mm',
  boxSizing: 'border-box',
  overflow: 'hidden',
  ...extra,
});

const nowrap: CSSProperties = { whiteSpace: 'nowrap' };

export default function RollSlipLabel({ data }: { data: RollSlipLabelData }) {
  const { product, pmCode, qtyPerRoll, direction, operator, slipDate, poNumber, party } = data;
  const qrUrl = buildRollSlipQrUrl(poNumber, party);

  return (
    <div
      className="roll-slip"
      style={{
        width: `${ROLL_SLIP_WIDTH_MM}mm`,
        height: `${ROLL_SLIP_HEIGHT_MM}mm`,
        boxSizing: 'border-box',
        padding: `${PAD_MM}mm`,
        background: '#fff',
        color: '#000',
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
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* ── Row 1: supplier, house name, QR ── */}
        <div style={{ display: 'flex', height: `${ROW1_MM}mm`, borderBottom: RULE }}>
          <div
            style={cell({
              width: `${COL1_MM}mm`,
              flex: '0 0 auto',
              borderRight: RULE,
              flexDirection: 'column',
              gap: '1.0mm',
            })}
          >
            <span style={{ fontSize: `${FS_LABEL}mm`, fontWeight: 700 }}>SUPPLIER</span>
            <span style={{ fontSize: `${FS_LABEL}mm`, fontWeight: 700, ...nowrap }}>
              {formatSlipDate(slipDate)}
            </span>
          </div>

          <div style={cell({ flex: '1 1 auto', minWidth: 0 })}>
            <span
              style={{
                fontSize: `${FS_HOUSE}mm`,
                fontWeight: 700,
                lineHeight: 1.08,
                textAlign: 'center',
                letterSpacing: '-0.05mm',
              }}
            >
              NOVELTY
              <br />
              CREATIONS
            </span>
          </div>

          <div style={cell({ width: `${QR_CELL_MM}mm`, flex: '0 0 auto' })}>
            <QrCode value={qrUrl} sizeMm={QR_MM} />
          </div>
        </div>

        {/* ── Row 2: product, spanning everything right of the label column ── */}
        <div style={{ display: 'flex', height: `${ROW2_MM}mm`, borderBottom: RULE }}>
          <div style={cell({ width: `${COL1_MM}mm`, flex: '0 0 auto', borderRight: RULE })}>
            <span style={{ fontSize: `${FS_LABEL}mm`, fontWeight: 700 }}>PRODUCT</span>
          </div>
          <div style={cell({ flex: '1 1 auto', minWidth: 0, justifyContent: 'flex-start' })}>
            <span
              style={{
                fontSize: `${FS_PRODUCT}mm`,
                fontWeight: 700,
                ...nowrap,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {product}
            </span>
          </div>
        </div>

        {/* ── Row 3: PM code + winding direction ── */}
        <div style={{ display: 'flex', height: `${ROW34_MM}mm`, borderBottom: RULE }}>
          <div style={cell({ width: `${COL1_MM}mm`, flex: '0 0 auto', borderRight: RULE })}>
            <span style={{ fontSize: `${FS_LABEL}mm`, fontWeight: 700 }}>PM CODE</span>
          </div>
          <div
            style={cell({
              width: `${COL2_MM}mm`,
              flex: '0 0 auto',
              borderRight: RULE,
              justifyContent: 'flex-start',
            })}
          >
            {/* A missing PM code prints an empty cell — never the word "null",
                and never BarTender's literal "<Empty>". */}
            <span style={{ fontSize: `${FS_VALUE}mm`, fontWeight: 700, ...nowrap }}>
              {pmCode ?? ''}
            </span>
          </div>
          <div style={cell({ flex: '1 1 auto', minWidth: 0, justifyContent: 'flex-start' })}>
            <span style={{ fontSize: `${FS_META}mm`, fontWeight: 700, ...nowrap }}>
              Direction:{direction ?? ''}
            </span>
          </div>
        </div>

        {/* ── Row 4: quantity + operator ── */}
        <div style={{ display: 'flex', flex: '1 1 auto' }}>
          <div style={cell({ width: `${COL1_MM}mm`, flex: '0 0 auto', borderRight: RULE })}>
            <span style={{ fontSize: `${FS_LABEL}mm`, fontWeight: 700 }}>QUANTITY</span>
          </div>
          <div
            style={cell({
              width: `${COL2_MM}mm`,
              flex: '0 0 auto',
              borderRight: RULE,
              justifyContent: 'flex-start',
            })}
          >
            <span style={{ fontSize: `${FS_VALUE}mm`, fontWeight: 700, ...nowrap }}>
              {qtyPerRoll > 0 ? `${qtyPerRoll} NOS` : ''}
            </span>
          </div>
          <div style={cell({ flex: '1 1 auto', minWidth: 0, justifyContent: 'flex-start' })}>
            <span style={{ fontSize: `${FS_META}mm`, fontWeight: 700, ...nowrap }}>
              Operator:{operator ?? ''}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
