import { describe, it, expect } from 'vitest';
import { slipSourceFromSeparation, separationsToOffer } from './slipSource';
import type { JobSeparation } from './types';

const row = (over: Partial<JobSeparation>): JobSeparation => ({
  id: 'r1', sr_no: 'AUG26-8', party: 'UPL-21', po_no: '4100011111', po_date: null,
  pm_code: '2000000671', material_name: 'MACARENA LABEL', quantity: 3200, unit: '2',
  job_status: null, rate: null, order_value: null, jc_status: null, aw_send_to: null,
  linked_job_id: null, linked_job_card_number: null, cancelled_at: null, cancelled_by: null,
  cancel_reason: null, created_by: null, created_at: '', updated_at: '', ...over,
});

describe('slipSourceFromSeparation', () => {
  it('fills the slip from the row: material as product, quantity as label qty', () => {
    expect(slipSourceFromSeparation(row({}))).toEqual({
      id: 'r1', from: 'separation', job_card_number: 'AUG26-8', job_name: 'MACARENA LABEL',
      label_qty: 3200, party: 'UPL-21', pm_code: '2000000671', po_number: '4100011111',
    });
  });
  it('prefers the job card number once the row has become a job', () => {
    expect(slipSourceFromSeparation(row({ linked_job_card_number: 'aug26-8' })).job_card_number).toBe('aug26-8');
  });
});

describe('separationsToOffer', () => {
  it('drops cancelled rows and rows already listed as their job', () => {
    const rows = [
      row({ id: 'keep' }),
      row({ id: 'cancelled', cancelled_at: '2026-10-01T00:00:00Z' }),
      row({ id: 'dupe', linked_job_id: 'job-1' }),
      row({ id: 'linked-elsewhere', linked_job_id: 'job-2' }),
    ];
    expect(separationsToOffer(rows, new Set(['job-1'])).map((r) => r.id)).toEqual(['keep', 'linked-elsewhere']);
  });
});
