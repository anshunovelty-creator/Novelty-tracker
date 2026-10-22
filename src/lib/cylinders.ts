// src/lib/cylinders.ts
// ============================================================
// Cylinder rules shared by the API and the Cylinders page.
// ============================================================

import type { Cylinder } from '@/lib/types';

export const CYLINDER_TYPES = ['Print', 'Magnetic'] as const;

/** 1/8" circular pitch: each tooth adds 3.175 mm of repeat. */
export const MM_PER_TOOTH = 3.175;

export function repeatLengthMm(teeth: number): number {
  return Math.round(teeth * MM_PER_TOOTH * 1000) / 1000;
}

type CylinderFields = Pick<Cylinder, 'serial_no' | 'teeth' | 'type' | 'manufacturer' | 'purchase_date'>;

/**
 * Validate a request body into columns. `partial` (PATCH) only checks the
 * fields present; a create needs serial, teeth and type.
 */
export function parseCylinder(
  body: Record<string, unknown>,
  partial = false,
): { fields: Partial<CylinderFields> } | { error: string } {
  const fields: Partial<CylinderFields> = {};
  const has = (k: string) => !partial || k in body;
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

  if (has('serial_no')) {
    const s = text(body.serial_no);
    if (!s) return { error: 'Serial number is required' };
    fields.serial_no = s;
  }
  if (has('teeth')) {
    const n = Number(body.teeth);
    if (body.teeth === '' || body.teeth == null || !Number.isInteger(n) || n <= 0) {
      return { error: 'Teeth must be a whole number above 0' };
    }
    fields.teeth = n;
  }
  if (has('type')) {
    const t = CYLINDER_TYPES.find((x) => x === body.type);
    if (!t) return { error: 'Type must be Print or Magnetic' };
    fields.type = t;
  }
  if ('manufacturer' in body) fields.manufacturer = text(body.manufacturer) || null;
  if ('purchase_date' in body) {
    const d = text(body.purchase_date);
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return { error: 'Purchase date must be a date' };
    fields.purchase_date = d || null;
  }
  return { fields };
}
