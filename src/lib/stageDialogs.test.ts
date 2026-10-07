import { describe, expect, it } from 'vitest';
import { holdRemark, qcRemark, partialDispatchPayload, fullDispatchPayload } from './stageDialogs';

describe('holdRemark', () => {
  it('joins a reason and a note', () => {
    expect(holdRemark('Plate remake', ' magenta cracked ')).toBe('Plate remake — magenta cracked');
  });
  it('stands alone as the reason when there is no note', () => {
    expect(holdRemark('Waiting on party', '  ')).toBe('Waiting on party');
  });
  it('uses only the note for Other or no reason', () => {
    expect(holdRemark('Other', 'Power cut')).toBe('Power cut');
    expect(holdRemark(null, 'Power cut')).toBe('Power cut');
    expect(holdRemark('Other', '')).toBe('');
  });
});

describe('qcRemark', () => {
  it('allows a blank clean pass', () => {
    expect(qcRemark('All rolls pass', '3', '')).toBe('');
  });
  it('names the rolls held', () => {
    expect(qcRemark('Pass with rolls held', ' 3, 4 ', 'Shade off master.')).toBe('Rolls 3, 4 held for re-check. Shade off master.');
    expect(qcRemark('Pass with rolls held', '7', '')).toBe('Rolls 7 held for re-check.');
  });
  it('marks a rejection', () => {
    expect(qcRemark('Reject batch', '', 'Wrong barcode')).toBe('Batch rejected at QC — Wrong barcode');
  });
});

describe('dispatch payloads', () => {
  it('sends the rack and vehicle on a partial dispatch', () => {
    expect(partialDispatchPayload({ qty: 35000, stockLeft: 15000, rack: 'A-02', vehicle: 'GJ 16 AX 4471' })).toEqual({
      new_status: 'Partial Dispatch',
      qty_dispatched: 35000,
      stock_remaining_qty: 15000,
      stock_remaining_location: 'A-02',
      remark: 'Vehicle GJ 16 AX 4471',
    });
  });
  it('leaves optional fields out when blank', () => {
    const p = fullDispatchPayload({ extraQty: 0, location: '', remark: '', vehicle: '' });
    expect(p).toEqual({ new_status: 'Dispatched', extra_label_qty: 0, extra_label_location: undefined, extra_label_remark: undefined, remark: undefined });
  });
});
