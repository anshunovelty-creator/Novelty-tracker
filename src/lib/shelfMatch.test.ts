import { describe, it, expect } from 'vitest';
import { freeShelfByPm, shelfOffer } from './shelfMatch';

const lot = (pm_code: string, qty: number, kind: 'Extra' | 'Manual' | 'Remaining', location: string | null = 'E-01', is_dispatched = false) =>
  ({ pm_code, qty, kind, location, is_dispatched });

describe('freeShelfByPm', () => {
  it('sums Extra and Manual, ignores Remaining and dispatched lots', () => {
    const m = freeShelfByPm([
      lot('pm-30412', 6000, 'Extra'), lot('PM-30412 ', 5000, 'Manual', 'E-02'),
      lot('PM-30412', 9000, 'Remaining'), lot('PM-30412', 4000, 'Extra', 'E-03', true),
    ]);
    expect(m.get('PM-30412')).toEqual({ qty: 11000, locations: ['E-01', 'E-02'] });
  });
});

describe('shelfOffer', () => {
  const shelf = freeShelfByPm([lot('PM-30412', 11000, 'Extra')]);
  const row = { pm_code: 'PM-30412', quantity: 40000, linked_job_id: null, cancelled_at: null };
  it('prints only the difference', () => {
    expect(shelfOffer(row, shelf)).toEqual({ onShelf: 11000, printQty: 29000, locations: ['E-01'] });
  });
  it('prints nothing when the shelf covers it', () => {
    expect(shelfOffer({ ...row, quantity: 8000 }, shelf)?.printQty).toBe(0);
  });
  it('stays quiet for lines with a job, cancelled lines and unmatched codes', () => {
    expect(shelfOffer({ ...row, linked_job_id: 'j' }, shelf)).toBeNull();
    expect(shelfOffer({ ...row, cancelled_at: '2026-10-01' }, shelf)).toBeNull();
    expect(shelfOffer({ ...row, pm_code: 'PM-1' }, shelf)).toBeNull();
  });
});
