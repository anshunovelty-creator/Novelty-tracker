// src/lib/dispatchRemark.ts
// ============================================================
// The vehicle number and LR / docket ride in a queued dispatch's `remark`,
// which the party email already prints — "Vehicle GJ 16 AX 4471 · LR
// LR-88213". No new columns: the stage dialogs write "Vehicle …" there
// already (lib/stageDialogs.ts), and Dispatch emails fills in the rest.
// Anything else someone typed into the remark is kept after the two.
// ============================================================

export type DispatchRemark = { vehicle: string; lr: string; rest: string };

const VEHICLE = /\bvehicle\s*(?:no\.?|number)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9 -]*[A-Z0-9])/i;
const LR      = /\b(?:lr|docket)\s*(?:no\.?)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9/-]*)/i;

export function parseDispatchRemark(remark: string | null | undefined): DispatchRemark {
  let text = (remark ?? '').trim();
  const v = text.match(VEHICLE);
  if (v) text = text.replace(v[0], '');
  const l = text.match(LR);
  if (l) text = text.replace(l[0], '');
  const rest = text.replace(/^[\s·,;|-]+|[\s·,;|-]+$/g, '').replace(/\s*[·,;|]\s*[·,;|]\s*/g, ' · ').trim();
  return { vehicle: v ? v[1].trim().toUpperCase() : '', lr: l ? l[1].trim().toUpperCase() : '', rest };
}

export function composeDispatchRemark({ vehicle, lr, rest }: DispatchRemark): string {
  return [
    vehicle.trim() && `Vehicle ${vehicle.trim().toUpperCase()}`,
    lr.trim() && `LR ${lr.trim().toUpperCase()}`,
    rest.trim(),
  ].filter(Boolean).join(' · ');
}
