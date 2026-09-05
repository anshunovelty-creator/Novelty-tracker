// src/components/admin/BoxSlipLabel.tsx
// ============================================================
// The box slip itself — a 1:1 replica of BarTender's
// "BOX SLIP 4X6 INCH.btw", rendered as HTML so it can print
// straight from the app to the TSC P210.
// See docs/printing-reference/03-box-slips/ for the originals.
// ============================================================
//
// WHY EVERY SIZE HERE IS IN MILLIMETRES
// The label is a physical object: 152.4 x 101.6 mm (6" x 4") of die-cut
// stock. CSS mm are real millimetres, so a value written here is the value
// that lands on the label — at any printer resolution, at any browser zoom.
// Tailwind classes are rem/px based and would drift the moment someone
// changed the root font size, so this component deliberately uses inline
// styles and no utility classes. Do not "tidy" them into Tailwind.
//
// WHY THESE FONTS
// System fonts only. A webfont that fails to load mid-print silently
// reflows the whole slip, and the packing PC may well be offline. Arial and
// Times New Roman ship with every Windows install and are what the
// BarTender original used anyway.
//
// The printer is 203 dpi = 8 dots/mm. Nothing here is finer than 0.25 mm
// (2 dots), so every rule and stroke lands on whole dots and prints crisp.

import type { CSSProperties } from 'react';

/** Physical label dimensions. The die-cut stock loaded in the P210. */
export const BOX_SLIP_WIDTH_MM = 152.4;
export const BOX_SLIP_HEIGHT_MM = 101.6;

export type BoxSlipLabelData = {
  materialName: string;
  pmCode: string | null;
  qtyPerBox: number;
  boxCount: number;
  /** ISO 'YYYY-MM-DD'. */
  mfgDate: string;
};

/**
 * ISO date → DD-MM-YYYY, by string surgery rather than `new Date()`.
 * Parsing 'YYYY-MM-DD' as a Date treats it as UTC midnight, which prints
 * yesterday's date for anyone west of Greenwich and, more to the point,
 * would make the MFG DATE on a physical box depend on the packing PC's
 * timezone. Splitting the string cannot drift.
 */
function formatMfgDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}-${m}-${y}`;
}

/** Thousands separators are absent on the BarTender original — 3900, not 3,900. */
function num(n: number): string {
  return String(n);
}

/**
 * The "this way up" arrow, drawn as SVG rather than a font glyph or an
 * image: it scales to any dpi without resampling, needs no asset to load,
 * and is a solid fill, which is exactly what a thermal head prints best.
 */
function UpArrow({ style }: { style?: CSSProperties }) {
  return (
    <svg
      viewBox="0 0 100 140"
      style={{ display: 'block', ...style }}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M50 0 L100 56 L72 56 L72 140 L28 140 L28 56 L0 56 Z" fill="#000" />
    </svg>
  );
}

const ARROW_W_MM = 18;
const ARROW_H_MM = 26;

/**
 * Left column width for the PM CODE / PACK SIZE / QUANTITY / MFG DATE labels.
 * Measured off the BarTender original, where the colons align 43mm in from
 * the label's left edge — 5mm of padding plus this.
 */
const FIELD_LABEL_W_MM = 41;

/** Row type size, matched to the original: the numbers are read across a warehouse. */
const FIELD_TEXT_MM = 6.6;

function Field({
  label,
  value,
  valueBold = true,
  valueSizeMm = FIELD_TEXT_MM,
}: {
  label: string;
  value: string;
  valueBold?: boolean;
  valueSizeMm?: number;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '1mm' }}>
      <span
        style={{
          width: `${FIELD_LABEL_W_MM}mm`,
          flex: '0 0 auto',
          fontSize: `${FIELD_TEXT_MM}mm`,
          fontWeight: 700,
          letterSpacing: '-0.05mm',
        }}
      >
        {label}
      </span>
      <span style={{ flex: '0 0 auto', fontSize: `${FIELD_TEXT_MM}mm`, fontWeight: 700 }}>:</span>
      <span
        style={{
          flex: '1 1 auto',
          fontSize: `${valueSizeMm}mm`,
          fontWeight: valueBold ? 700 : 400,
          // A long value shrinks rather than wrapping onto a second line and
          // pushing MFG DATE off the bottom of the label.
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * One box slip at exact physical size.
 *
 * Renders at 1:1 — 152.4mm wide on screen as well as on the label. The
 * caller scales it for preview with a CSS transform; scaling here would
 * make the printed output depend on a preview setting.
 */
export default function BoxSlipLabel({ data }: { data: BoxSlipLabelData }) {
  const { materialName, pmCode, qtyPerBox, boxCount, mfgDate } = data;

  // The two lines the original states differently for the same fact: PACK
  // SIZE spells out the total, QUANTITY stops at the multiplication.
  const packSize = `${num(qtyPerBox)} X ${num(boxCount)} BOX =${num(qtyPerBox * boxCount)}`;
  const quantity = `${num(qtyPerBox)} X ${num(boxCount)} BOX`;

  return (
    <div
      className="box-slip"
      style={{
        width: `${BOX_SLIP_WIDTH_MM}mm`,
        height: `${BOX_SLIP_HEIGHT_MM}mm`,
        // border-box so the padding below eats into the 152.4mm rather than
        // adding to it — an overflowing slip silently spills onto a second
        // label and wastes a whole roll before anyone notices.
        boxSizing: 'border-box',
        padding: '4mm 5mm',
        background: '#fff',
        color: '#000',
        fontFamily: 'Arial, Helvetica, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* ── Header: arrows flanking the handling notice and the house name ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '2mm' }}>
        <UpArrow style={{ width: `${ARROW_W_MM}mm`, height: `${ARROW_H_MM}mm`, flex: '0 0 auto' }} />

        <div style={{ flex: '1 1 auto', textAlign: 'center', minWidth: 0 }}>
          <div
            style={{
              fontFamily: '"Times New Roman", Times, serif',
              fontSize: '8.2mm',
              lineHeight: 1.05,
            }}
          >
            THIS SIDE UP
          </div>
          <div style={{ fontSize: '5.8mm', lineHeight: 1.2, marginTop: '0.8mm' }}>
            Do Not Stack Horizontally
          </div>
          {/* Reversed out — white on a solid black bar, as on the original.
              Thermal heads render solid fills well, so this stays legible
              even as the ribbon wears. */}
          <div
            style={{
              display: 'inline-block',
              marginTop: '1mm',
              padding: '0.6mm 2mm',
              background: '#000',
              color: '#fff',
              fontSize: '8.4mm',
              fontWeight: 700,
              lineHeight: 1.15,
              letterSpacing: '-0.1mm',
              whiteSpace: 'nowrap',
            }}
          >
            NOVELTY CREATIONS
          </div>
        </div>

        <UpArrow style={{ width: `${ARROW_W_MM}mm`, height: `${ARROW_H_MM}mm`, flex: '0 0 auto' }} />
      </div>

      {/* ── Material name, captioned and boxed ── */}
      <div
        style={{
          textAlign: 'center',
          fontSize: '5.2mm',
          fontWeight: 700,
          marginTop: '1.5mm',
        }}
      >
        MATERIAL NAME
      </div>
      <div
        style={{
          // 0.5mm = 4 dots at 203 dpi: heavy enough to survive a worn ribbon,
          // thin enough not to read as a black bar.
          border: '0.5mm solid #000',
          marginTop: '1.2mm',
          height: '15mm',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 2mm',
          boxSizing: 'border-box',
        }}
      >
        <span
          style={{
            fontSize: '5.6mm',
            fontWeight: 700,
            textAlign: 'center',
            lineHeight: 1.15,
            // Two lines maximum; a longer material name clips rather than
            // overflowing the box and shunting the rows below it.
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {materialName}
        </span>
      </div>

      {/* ── The four data rows ── */}
      <div
        style={{
          flex: '1 1 auto',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-evenly',
          marginTop: '1.5mm',
        }}
      >
        {/* PM code prints lighter and smaller than the rest, matching the
            original — it is a reference someone reads, not a number anyone
            checks at a glance across the warehouse. An absent PM code prints
            an empty value, never the string "null". */}
        <Field label="PM CODE" value={pmCode ?? ''} valueBold={false} valueSizeMm={5.6} />
        <Field label="PACK SIZE" value={packSize} />
        <Field label="QUANTITY" value={quantity} />
        <Field label="MFG DATE" value={formatMfgDate(mfgDate)} />
      </div>
    </div>
  );
}
