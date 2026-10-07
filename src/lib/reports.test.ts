import { describe, it, expect } from 'vitest';
import { addMonths, istMonthStart, median, buildReport, type DispatchRow, type StatusLogRow } from './reports';

const disp = (p: Partial<DispatchRow>): DispatchRow => ({
  job_id: 'j', dispatched_at: '2026-09-10T06:00:00Z', is_on_time: true, month_key: '2026-09',
  party: 'Riverline', po_date: '2026-09-01', created_at: '2026-09-01T05:00:00Z', ...p,
});
const log = (p: Partial<StatusLogRow>): StatusLogRow => ({
  job_id: 'j', status: 'In Printing', changed_at: '2026-09-02T06:00:00Z', qty_dispatched: null, party: 'Riverline', ...p,
});

describe('month helpers', () => {
  it('adds months across a year', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-11', 3)).toBe('2027-02');
  });
  it('starts an IST month at 18:30 UTC the day before', () => {
    expect(istMonthStart('2026-10')).toBe('2026-09-30T18:30:00.000Z');
  });
  it('takes the middle of an even list as the mean of the two', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('buildReport', () => {
  it('rates on-time over judged dispatches and compares with last month', () => {
    const r = buildReport('2026-09', [
      disp({ job_id: 'a' }), disp({ job_id: 'b', is_on_time: false }),
      disp({ job_id: 'c', is_on_time: null }),
      disp({ job_id: 'd', month_key: '2026-08', dispatched_at: '2026-08-20T06:00:00Z' }),
    ], []);
    expect(r.kpis.onTimeRate).toBe(50);
    expect(r.kpis.jobsDispatched).toBe(3);
    expect(r.previous.onTimeRate).toBe(100);
    expect(r.trend.map((t) => t.month)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
  });

  it('counts PO date to dispatch in IST days', () => {
    // 01 Sep PO, dispatched 10 Sep 23:00 IST (17:30 UTC) — 9 days, not 10.
    const r = buildReport('2026-09', [disp({ dispatched_at: '2026-09-10T17:30:00Z' })], []);
    expect(r.kpis.medianPoDays).toBe(9);
  });

  it('sums labels shipped from full and partial dispatches in the month', () => {
    const r = buildReport('2026-09', [], [
      log({ status: 'Partial Dispatch', qty_dispatched: 1000 }),
      log({ status: 'Dispatched', qty_dispatched: 500, changed_at: '2026-09-20T06:00:00Z' }),
      log({ status: 'Dispatched', qty_dispatched: 9999, changed_at: '2026-10-01T06:00:00Z' }),
    ]);
    expect(r.kpis.labelsShipped).toBe(1500);
    expect(r.parties[0]).toMatchObject({ party: 'Riverline', labels: 1500 });
  });

  it('measures stage waits from one change to the next, skipping open spells', () => {
    const r = buildReport('2026-09', [], [
      log({ job_id: 'a', status: 'Shade Card Sent', changed_at: '2026-09-01T06:00:00Z' }),
      log({ job_id: 'a', status: 'In Printing',     changed_at: '2026-09-05T06:00:00Z' }),  // open — not counted
      log({ job_id: 'b', status: 'Shade Card Sent', changed_at: '2026-09-02T06:00:00Z' }),
      log({ job_id: 'b', status: 'In Printing',     changed_at: '2026-09-04T06:00:00Z' }),
    ]);
    expect(r.waits).toEqual([{ stage: 'Shade Card Sent', medianDays: 3, count: 2 }]);
  });
});
