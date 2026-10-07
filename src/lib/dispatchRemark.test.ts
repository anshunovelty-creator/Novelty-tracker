import { describe, it, expect } from 'vitest';
import { parseDispatchRemark, composeDispatchRemark } from './dispatchRemark';

describe('dispatch remark', () => {
  it('reads what the stage dialog writes', () => {
    expect(parseDispatchRemark('Vehicle GJ 16 AX 4471')).toEqual({ vehicle: 'GJ 16 AX 4471', lr: '', rest: '' });
  });
  it('reads vehicle, LR and keeps other text', () => {
    expect(parseDispatchRemark('Vehicle GJ16AX4471 · LR LR-88213 · 12 rolls')).toEqual({ vehicle: 'GJ16AX4471', lr: 'LR-88213', rest: '12 rolls' });
    expect(parseDispatchRemark('12 rolls, docket no: 5521')).toEqual({ vehicle: '', lr: '5521', rest: '12 rolls' });
  });
  it('treats an empty remark as empty', () => {
    expect(parseDispatchRemark(null)).toEqual({ vehicle: '', lr: '', rest: '' });
  });
  it('round-trips', () => {
    const r = { vehicle: 'gj 16 ax 4471', lr: 'lr-88213', rest: '12 rolls' };
    expect(composeDispatchRemark(r)).toBe('Vehicle GJ 16 AX 4471 · LR LR-88213 · 12 rolls');
    expect(parseDispatchRemark(composeDispatchRemark(r))).toEqual({ vehicle: 'GJ 16 AX 4471', lr: 'LR-88213', rest: '12 rolls' });
    expect(composeDispatchRemark({ vehicle: '', lr: '', rest: '' })).toBe('');
  });
});
