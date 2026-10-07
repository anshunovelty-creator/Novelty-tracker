// src/lib/stageDialogs.ts
// What the stage dialogs (components/admin/modals) send to /status, kept out
// of the .tsx so it can be tested. There are no columns for the hold reason,
// the QC outcome, the rolls held or the vehicle number — each one is folded
// into the remark the route already stores and shows.

export const HOLD_REASONS = ['Waiting on party', 'Plate remake', 'Material short', 'Machine down', 'Other'] as const;
export type HoldReason = (typeof HOLD_REASONS)[number];

/** "Plate remake — magenta cracked", or just the note when the reason is Other. */
export function holdRemark(reason: HoldReason | null, note: string): string {
  const n = note.trim();
  if (!reason || reason === 'Other') return n;
  return n ? `${reason} — ${n}` : reason;
}

export const QC_RESULTS = ['All rolls pass', 'Pass with rolls held', 'Reject batch'] as const;
export type QCResult = (typeof QC_RESULTS)[number];

/** The remark saved for each QC outcome. A clean pass may be blank. */
export function qcRemark(result: QCResult, rollsHeld: string, remarks: string): string {
  const r = remarks.trim();
  if (result === 'Pass with rolls held') {
    const held = `Rolls ${rollsHeld.trim()} held for re-check.`;
    return r ? `${held} ${r}` : held;
  }
  if (result === 'Reject batch') return `Batch rejected at QC — ${r}`;
  return r;
}

export type PartialDispatchInput = {
  qty:       number;
  stockLeft: number;
  rack:      string;
  vehicle:   string;
};

/** The /status body for a partial dispatch. The vehicle number rides as the
 *  remark, which the party's dispatch email prints. */
export function partialDispatchPayload(d: PartialDispatchInput) {
  return {
    new_status:               'Partial Dispatch' as const,
    qty_dispatched:           d.qty,
    stock_remaining_qty:      d.stockLeft,
    stock_remaining_location: d.rack || undefined,
    remark:                   d.vehicle ? `Vehicle ${d.vehicle}` : undefined,
  };
}

export type FullDispatchInput = {
  extraQty: number;
  location: string;
  remark:   string;
  vehicle:  string;
};

/** The /status body for a full dispatch. 0 extras is the "none" answer — the
 *  route ignores it. The vehicle number rides as the remark. */
export function fullDispatchPayload(d: FullDispatchInput) {
  return {
    new_status:           'Dispatched' as const,
    extra_label_qty:      d.extraQty,
    extra_label_location: d.location || undefined,
    extra_label_remark:   d.remark   || undefined,
    remark:               d.vehicle ? `Vehicle ${d.vehicle}` : undefined,
  };
}
