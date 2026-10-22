import { describe, it, expect } from 'vitest';
import { parseCylinder, repeatLengthMm } from './cylinders';

describe('repeatLengthMm', () => {
  it('is teeth × 3.175', () => {
    expect(repeatLengthMm(96)).toBe(304.8);
    expect(repeatLengthMm(80)).toBe(254);
    expect(repeatLengthMm(101)).toBe(320.675);
  });
});

describe('parseCylinder', () => {
  it('a create needs serial, teeth and type', () => {
    expect(parseCylinder({ serial_no: ' C-01 ', teeth: '96', type: 'Print', manufacturer: '', purchase_date: '2026-10-01' }))
      .toEqual({ fields: { serial_no: 'C-01', teeth: 96, type: 'Print', manufacturer: null, purchase_date: '2026-10-01' } });
    expect(parseCylinder({ teeth: 96, type: 'Print' })).toEqual({ error: 'Serial number is required' });
    expect(parseCylinder({ serial_no: 'C', teeth: 9.5, type: 'Print' })).toHaveProperty('error');
    expect(parseCylinder({ serial_no: 'C', teeth: 0, type: 'Print' })).toHaveProperty('error');
    expect(parseCylinder({ serial_no: 'C', teeth: 96, type: 'print' })).toHaveProperty('error');
  });
  it('an edit checks only what it sends', () => {
    expect(parseCylinder({ manufacturer: 'Kocher' }, true)).toEqual({ fields: { manufacturer: 'Kocher' } });
    expect(parseCylinder({ serial_no: '' }, true)).toHaveProperty('error');
  });
});
