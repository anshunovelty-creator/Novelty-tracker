// src/components/admin/RollSlipLabel.tsx
// ============================================================
// The roll slip — a replica of BarTender's "ROLL SLIP 4X6 INCH.btw".
// The filename lies: the artwork is 76.2 x 32.2 mm, not 4x6 inches.
// See docs/printing-reference/04-roll-slips/ for the original.
// ============================================================
//
// Same rules as BoxSlipLabel: millimetres rather than Tailwind's rem scale
// so the print cannot drift, and system fonts because a webfont that fails
// to load on an offline packing PC would silently reflow the label.
//
// This slip is small — 76.2 x 32.2 mm — so type runs down to 2.8mm. At the
// P210's 203 dpi that is still ~22 dots tall, which thermal renders cleanly.

import type { CSSProperties } from 'react';
import qrcode from 'qrcode-generator';

/** Physical label dimensions. */
export const ROLL_SLIP_WIDTH_MM = 76.2;
export const ROLL_SLIP_HEIGHT_MM = 32.2;

/** Where the QR points when no app URL is configured — today's behaviour. */
const FALLBACK_SITE = 'https://noveltylabels.in';

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
 * Every character costs QR modules, and this code has to survive being
 * printed 12mm wide at 203 dpi. Measured on a representative URL:
 *
 *   full party,     EC L  → 33 modules, 2.91 dots/module,  7% recovery
 *   full party,     EC M  → 37 modules, 2.59 dots/module, 15% recovery
 *   first 2 words,  EC M  → 33 modules, 2.91 dots/module, 15% recovery  ← this
 *
 * The truncation buys back exactly the density that error-correction level M
 * costs, so the code is no denser than the EC L version yet tolerates more
 * scuffing. It is safe because /track matches the party with a substring
 * ilike (`%term%`), not an equality test — "ACME BEVERAGES" still resolves
 * "ACME BEVERAGES PVT LTD" — and the PO number has to match as well.
 *
 * If /track ever switches to an exact party match, this must send the full
 * name again and the QR will need more physical room.
 */
export function buildRollSlipQrUrl(poNumber: string | null, party: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || FALLBACK_SITE;
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
 * SVG is resolution-independent, so the modules land on exact dot boundaries
 * at whatever dpi the driver rasterises to — a canvas would be resampled and
 * blur the module edges, which is what makes a small QR fail to scan. It is
 * also foreground content, so it prints even if the operator forgets Chrome's
 * "Background graphics" checkbox.
 *
 * Error correction M (~15%) is the usual choice for a printed label: enough
 * redundancy to survive a scuff, without inflating the module count on a code
 * this physically small.
 */
function QrCode({ value, sizeMm }: { value: string; sizeMm: number }) {
  // typeNumber 0 = pick the smallest version that fits the data. Fewer
  // modules means physically larger modules, which is the difference
  // between a QR that scans off a 12mm square and one that does not —
  // see buildRollSlipQrUrl for the density budget this is working within.
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
      {/* Quiet zone is supplied by the surrounding cell padding, not here. */}
      <path d={parts.join('')} fill="#000" />
    </svg>
  );
}

// ── Table geometry, measured off the BarTender original ──────
const PAD_MM = 1.5;            // inset from the die-cut edge to the table
const BORDER_MM = 0.35;        // 0.35mm ≈ 3 dots at 203 dpi
const COL1_MM = 20;            // the SUPPLIER / PRODUCT / PM CODE / QUANTITY column
const COL2_MM = 20;            // the value column on the PM CODE and QUANTITY rows
const QR_CELL_MM = 14;         // right-hand cell of the top row
const ROW1_MM = 12.8;
const ROW2_MM = 6.2;
const ROW34_MM = 5.1;

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
              gap: '1mm',
            })}
          >
            <span style={{ fontSize: '2.8mm', fontWeight: 700 }}>SUPPLIER</span>
            <span style={{ fontSize: '2.8mm', fontWeight: 700 }}>{formatSlipDate(slipDate)}</span>
          </div>

          <div style={cell({ flex: '1 1 auto', minWidth: 0 })}>
            <span
              style={{
                fontSize: '4.4mm',
                fontWeight: 700,
                lineHeight: 1.05,
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
            {/* 12mm, as large as row 1 allows: at 203 dpi that is 2.9 dots
                per module, and every tenth of a millimetre matters here. */}
            <QrCode value={qrUrl} sizeMm={12} />
          </div>
        </div>

        {/* ── Row 2: product, spanning everything right of the label column ── */}
        <div style={{ display: 'flex', height: `${ROW2_MM}mm`, borderBottom: RULE }}>
          <div style={cell({ width: `${COL1_MM}mm`, flex: '0 0 auto', borderRight: RULE })}>
            <span style={{ fontSize: '2.9mm', fontWeight: 700 }}>PRODUCT</span>
          </div>
          <div style={cell({ flex: '1 1 auto', minWidth: 0, justifyContent: 'flex-start' })}>
            <span
              style={{
                fontSize: '3mm',
                fontWeight: 700,
                whiteSpace: 'nowrap',
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
            <span style={{ fontSize: '2.9mm', fontWeight: 700 }}>PM CODE</span>
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
            <span style={{ fontSize: '2.9mm', fontWeight: 700, whiteSpace: 'nowrap' }}>
              {pmCode ?? ''}
            </span>
          </div>
          <div style={cell({ flex: '1 1 auto', minWidth: 0, justifyContent: 'flex-start' })}>
            <span style={{ fontSize: '2.9mm', fontWeight: 700, whiteSpace: 'nowrap' }}>
              Direction:{direction ?? ''}
            </span>
          </div>
        </div>

        {/* ── Row 4: quantity + operator ── */}
        <div style={{ display: 'flex', flex: '1 1 auto' }}>
          <div style={cell({ width: `${COL1_MM}mm`, flex: '0 0 auto', borderRight: RULE })}>
            <span style={{ fontSize: '2.9mm', fontWeight: 700 }}>QUANTITY</span>
          </div>
          <div
            style={cell({
              width: `${COL2_MM}mm`,
              flex: '0 0 auto',
              borderRight: RULE,
              justifyContent: 'flex-start',
            })}
          >
            <span style={{ fontSize: '2.9mm', fontWeight: 700, whiteSpace: 'nowrap' }}>
              {qtyPerRoll > 0 ? `${qtyPerRoll} NOS` : ''}
            </span>
          </div>
          <div style={cell({ flex: '1 1 auto', minWidth: 0, justifyContent: 'flex-start' })}>
            <span style={{ fontSize: '2.9mm', fontWeight: 700, whiteSpace: 'nowrap' }}>
              Operator:{operator ?? ''}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
