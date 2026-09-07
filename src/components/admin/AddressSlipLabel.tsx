// src/components/admin/AddressSlipLabel.tsx
// ============================================================
// The consignment address slip — BarTender's "ADDRESS 4 X 6.btw (NOVELTY
// LABELS)", 152.4 x 101.5 mm. One to a sheet, the whole 6" x 4".
// ============================================================
//
// WHY THIS ONE HAS NO TABLE AND NO JOB
// Every other slip in here describes what is inside the carton, so it is
// ruled into fields and reads off a job. This one is what a courier reads on
// the outside, and a courier wants two blocks of plain address text. There
// is nothing on it the app can derive: the destination is wherever this
// particular consignment is going, which is not a column on `jobs`. So both
// blocks are free text, and the slip prints without a job selected — the
// only tab on the page that works before a job is picked.
//
// WHY THE SENDER IS A CONSTANT AND THE DESTINATION IS NOT
// DEFAULT_FROM_ADDRESS is the factory. It is the same on every consignment
// that has ever left the building, so retyping it would be pure error
// surface — it is pre-filled and stays editable only so a one-off (a
// different shed, a changed mobile number) does not need a deploy.
//
// WHY THE BLOCKS ARE POSITIONED THE WAY THEY ARE
// Destination top-left, sender bottom-right, matching the original artwork
// and ordinary postal convention: the eye that matters is the courier's, and
// it goes to the top-left corner first. The sender block is pushed down by
// `margin-top: auto` rather than a measured offset so a long destination
// address grows downward into the gap instead of colliding with it.
//
// WHY THE BLOCKS CAN BE NUDGED
// That default is right for a five-line destination and wrong for a
// thirteen-line one, and there is no layout rule that gets both — how much
// room an address needs is a property of the address, which only the person
// typing it knows. So each block carries an offset in millimetres that the
// operator drags in the preview.
//
// The offset is a `translate`, deliberately, not a change to the margins:
// translation happens after layout, so nudging one block cannot reflow the
// other or change where the text wraps. The block you drag is the only thing
// that moves, and letting go of it at 0,0 restores exactly the artwork above.
//
// This component stays passive. It renders whatever offsets it is handed and
// reports where a drag started; every pixel-to-millimetre conversion and all
// the clamping lives in SlipsManager, so the print surface — which passes no
// handler — is inert and pixel-identical to the preview.

import type { CSSProperties } from 'react';

/** Full sheet — this slip is the 6" x 4" label, not a tile on it. */
export const ADDRESS_SLIP_WIDTH_MM = 152.4;
export const ADDRESS_SLIP_HEIGHT_MM = 101.6;

/**
 * The factory address, pre-filled into the From box on every address slip.
 *
 * Kept verbatim from the BarTender original including the "MOB NO" line,
 * because this is what clients and couriers have been reading off cartons
 * for years. The original's line breaks were its text box wrapping rather
 * than intent, so the street line is joined back up here and left to wrap
 * naturally at whatever width it is given.
 */
export const DEFAULT_FROM_ADDRESS = [
  'NOVELTY LABELS',
  'Plot No-307 to 311, Shed No-18,',
  'My Space (Rajat Pharma), Opp Cosmos Textile Mills,',
  'Ramdev Chokdi, G.I.D.C.',
  'Ankleshwar-393002,',
  'Dist-Bharuch, Gujarat',
  'MOB NO -91 9558992674',
].join('\n');

/** Which of the two blocks — the addressee, or the factory. */
export type AddressBlock = 'to' | 'from';

/** A nudge in millimetres from a block's default position. */
export type BlockOffset = { x: number; y: number };

export const NO_OFFSET: BlockOffset = { x: 0, y: 0 };

export type AddressSlipLabelData = {
  /** Destination, as typed. Newlines are honoured. */
  toAddress: string;
  /** Sender, as typed. Defaults to DEFAULT_FROM_ADDRESS. */
  fromAddress: string;
  /** Nudge from the default position; {0,0} is the original artwork. */
  toOffset: BlockOffset;
  fromOffset: BlockOffset;
};

const PAD_MM = 8;
const FS_MM = 4;          // ~2.8mm cap height, the size the original prints at
const LINE_HEIGHT = 1.45;

/**
 * A block of address text.
 *
 * `pre-line` keeps the operator's own line breaks — an address is written in
 * lines and re-flowing it into a paragraph would be wrong — while still
 * wrapping any single line too long for the column, so a long street name
 * cannot run off the edge of the label.
 */
const block: CSSProperties = {
  fontSize: `${FS_MM}mm`,
  fontWeight: 700,
  lineHeight: LINE_HEIGHT,
  whiteSpace: 'pre-line',
  overflowWrap: 'break-word',
};

export default function AddressSlipLabel({
  data,
  onBlockPointerDown,
}: {
  data: AddressSlipLabelData;
  /**
   * Supplied only by the on-screen preview. Its presence is what turns the
   * blocks into drag handles; the print surface omits it and gets a plain,
   * non-interactive label with no cursor, outline or hit-testing of its own.
   */
  onBlockPointerDown?: (block: AddressBlock, e: React.PointerEvent<HTMLDivElement>) => void;
}) {
  const { toAddress, fromAddress, toOffset, fromOffset } = data;
  const draggable = Boolean(onBlockPointerDown);

  /** Chrome that only exists while the operator is positioning the blocks. */
  const grab = (block: AddressBlock): CSSProperties =>
    draggable
      ? {
          cursor: 'grab',
          // Without this a touch drag scrolls the page instead of moving the
          // block — pointermove never reaches us once the browser has claimed
          // the gesture for panning.
          touchAction: 'none',
          outline: '1px dashed rgba(0,0,0,0.28)',
          outlineOffset: '2mm',
          borderRadius: '1mm',
        }
      : {};

  const dragProps = (block: AddressBlock) =>
    onBlockPointerDown
      ? { onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => onBlockPointerDown(block, e) }
      : {};

  return (
    <div
      className="address-slip"
      style={{
        width: `${ADDRESS_SLIP_WIDTH_MM}mm`,
        height: `${ADDRESS_SLIP_HEIGHT_MM}mm`,
        boxSizing: 'border-box',
        padding: `${PAD_MM}mm`,
        background: '#fff',
        color: '#000',
        // System faces, not the app's webfont — see RollSlipCompactLabel.
        fontFamily: 'Arial, Helvetica, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        // An address longer than the sheet is clipped rather than allowed to
        // paginate: a second, near-empty label per consignment would waste
        // stock and confuse the packer more than a visibly truncated block.
        overflow: 'hidden',
      }}
    >
      {/* ── Destination ── */}
      <div
        style={{
          ...block,
          maxWidth: '78%',
          transform: `translate(${toOffset.x}mm, ${toOffset.y}mm)`,
          ...grab('to'),
        }}
        {...dragProps('to')}
      >
        {'TO,\n'}
        {toAddress}
      </div>

      {/* ── Sender, pushed to the foot of the label and indented right ── */}
      <div
        style={{
          ...block,
          marginTop: 'auto',
          marginLeft: '42%',
          transform: `translate(${fromOffset.x}mm, ${fromOffset.y}mm)`,
          ...grab('from'),
        }}
        {...dragProps('from')}
      >
        {'FROM ,\n'}
        {fromAddress}
      </div>
    </div>
  );
}
