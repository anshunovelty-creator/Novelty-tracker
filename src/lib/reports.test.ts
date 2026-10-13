import { describe, it, expect } from 'vitest';
import { addMonths, previousPeriod, presetPeriod, artworkKind, jobCardKind, analyse, groupKey, cyclesOf, likelyDuplicates, partyKey, segmentsOf, rateChecksOf, pmKey, approvalsOf, lifecycleOf, forecastOf, type SepRow, type ShadeCard } from './reports';

const row = (p: Partial<SepRow>): SepRow => ({
  id: Math.random().toString(36), sr_no: null, day: '2026-10-05', party: 'Arysta', po_no: 'PO1',
  pm_code: 'PM1', material_name: 'Front label', quantity: 1000, unit: '1', rate: 2, order_value: 2000,
  jc_status: 'DONE', aw_send_to: 'REPEAT', cancelled: false, ...p,
});

describe('periods', () => {
  it('adds months across a year', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-11', 3)).toBe('2027-02');
  });
  it('compares month-to-date with the same days of last month', () => {
    expect(previousPeriod({ from: '2026-10-01', to: '2026-10-13' })).toEqual({ from: '2026-09-01', to: '2026-09-13' });
    expect(previousPeriod({ from: '2026-03-01', to: '2026-03-31' })).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(previousPeriod({ from: '2026-03-01', to: '2026-03-30' })).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(previousPeriod({ from: '2026-08-01', to: '2026-10-13' })).toEqual({ from: '2026-05-01', to: '2026-07-13' });
  });
  it('compares a custom range with the same number of days before it', () => {
    expect(previousPeriod({ from: '2026-10-05', to: '2026-10-11' })).toEqual({ from: '2026-09-28', to: '2026-10-04' });
  });
  it('starts the financial year in April', () => {
    expect(presetPeriod('fy', '2026-10-13', '2026-08-01').from).toBe('2026-04-01');
    expect(presetPeriod('fy', '2027-02-10', '2026-08-01').from).toBe('2026-04-01');
    expect(presetPeriod('last-month', '2026-10-13', '2026-08-01')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });
});

describe('free-text classifiers', () => {
  it('reads AW Send To', () => {
    expect(artworkKind('REPEAT (LAST PO:5000465198)')).toBe('Repeat');
    expect(artworkKind('N/A')).toBe('Not recorded');
    expect(artworkKind(null)).toBe('Not recorded');
    expect(artworkKind('SENT ON 29-09-2026')).toBe('New artwork');
  });
  it('reads JC Status', () => {
    expect(jobCardKind('DONE MFG : ECO CARE')).toBe('Job card made');
    expect(jobCardKind('PO HOLD BY SOMEONE')).toBe('On hold / cancelled');
    expect(jobCardKind('N/A')).toBe('Not made yet');
  });
});

describe('analyse', () => {
  const rows = [
    row({ day: '2026-08-01', party: 'Old Co', order_value: 500 }),
    row({ day: '2026-09-03', party: 'Gone Ltd', order_value: 900 }),
    row({ day: '2026-09-04', party: 'arysta ', order_value: 1000 }),
    row({ day: '2026-10-02', party: 'ARYSTA', po_no: 'PO1', unit: '2', order_value: 3000, quantity: 1000 }),
    row({ day: '2026-10-02', party: 'Arysta', po_no: 'PO1', unit: '1', order_value: 1000, quantity: 1000 }),
    row({ day: '2026-10-09', party: 'Fresh Pvt', po_no: 'PO9', unit: '1&2', order_value: 6000, quantity: 3000, aw_send_to: 'KAROMI' }),
    row({ day: '2026-10-10', party: 'Arysta', order_value: 99999, cancelled: true }),
  ];
  const a = analyse(rows, { from: '2026-10-01', to: '2026-10-13' }, { unit: null, group: null, party: null }, '2026-10-13');

  it('totals the period, leaving cancelled rows out', () => {
    expect(a.totals).toMatchObject({ value: 10000, orders: 3, pos: 2, qty: 5000, parties: 2, avgRate: 2 });
    expect(a.cancelled).toEqual({ orders: 1, value: 99999 });
    expect(a.prevTotals.value).toBe(1900);   // 1–13 Sep
  });
  it('merges party spellings and compares each with last period', () => {
    const ary = a.parties.find((p) => p.key === 'ARYSTA')!;
    expect(ary).toMatchObject({ value: 4000, orders: 2, pos: 1, prevValue: 1000, share: 40 });
    expect(ary.byUnit).toEqual({ '1': 1000, '2': 3000 });
  });
  it('splits by unit and finds new and quiet parties', () => {
    expect(a.units.map((u) => [u.key, u.value])).toEqual([['1', 1000], ['2', 3000], ['1&2', 6000]]);
    expect(a.newParties).toEqual(['Fresh Pvt']);
    expect(a.quietParties).toEqual([{ party: 'Gone Ltd', prevValue: 900 }]);
    expect(a.artwork.find((s) => s.key === 'New artwork')!.value).toBe(6000);
  });
  it('filters by unit and party', () => {
    expect(analyse(rows, a.period, { unit: '2', group: null, party: null }, '2026-10-13').totals.value).toBe(3000);
    expect(analyse(rows, a.period, { unit: null, group: null, party: 'ARYSTA' }, '2026-10-13').totals.value).toBe(4000);
  });
  it('buckets the trend by day for a month, by month for a year', () => {
    expect(a.trend.grain).toBe('day');
    expect(a.trend.buckets).toHaveLength(13);
    expect(a.trend.buckets[1]).toMatchObject({ key: '2026-10-02', value: 4000 });
    expect(analyse(rows, { from: '2026-04-01', to: '2026-10-13' }, { unit: null, group: null, party: null }, '2026-10-13').trend.grain).toBe('month');
  });
});

describe('customer groups', () => {
  it('reads the group off plant names', () => {
    expect(groupKey('UPL - 03')).toBe('UPL');
    expect(groupKey('sml-1')).toBe('SML');
    expect(groupKey('GINNI (HARIDWAR)')).toBe('GINNI');
    expect(groupKey('PI INDUSTRIES')).toBe('PI INDUSTRIES');
  });
  it('rolls plants up and filters by group', () => {
    const rows = [
      row({ party: 'UPL - 03', order_value: 3000 }), row({ party: 'UPL - 13', order_value: 1000 }),
      row({ party: 'Arysta', order_value: 1000 }),
    ];
    const a = analyse(rows, { from: '2026-10-01', to: '2026-10-13' }, { unit: null, group: null, party: null }, '2026-10-13');
    expect(a.groups[0]).toMatchObject({ key: 'UPL', value: 4000, plants: 2, share: 80 });
    expect(analyse(rows, a.period, { unit: null, group: 'UPL', party: null }, '2026-10-13').totals.value).toBe(4000);
  });
  it('flags near-identical names but not plants of one group', () => {
    const rows = [
      row({ party: 'COROMANDAL' }), row({ party: 'COROMANDEL' }), row({ party: 'COROMANDEL' }),
      row({ party: 'SML - 1' }), row({ party: 'SML - 2' }),
    ];
    expect(likelyDuplicates(rows)).toEqual([{ a: 'COROMANDAL', b: 'COROMANDEL', aOrders: 1, bOrders: 2 }]);
  });
});

describe('reorder cycles', () => {
  const key = (r: SepRow) => partyKey(r.party);
  it('takes the median gap, merging PO dates within 3 days', () => {
    const rows = ['2026-08-01', '2026-08-02', '2026-08-31', '2026-09-30'].map((day) => row({ day, quantity: 1000, order_value: 2000 }));
    const [c] = cyclesOf(rows, key, '2026-10-13');
    expect(c).toMatchObject({ orders: 3, cycleDays: 30, lastDay: '2026-09-30', dueDay: '2026-10-30', lateDays: -17, status: 'upcoming' });
    expect(c.typicalQty).toBe(1000);
  });
  it('calls it due, overdue, then lapsed as days pass', () => {
    const rows = ['2026-08-01', '2026-08-31'].map((day) => row({ day }));
    expect(cyclesOf(rows, key, '2026-09-20')[0].status).toBe('due');       // due 30 Sep
    expect(cyclesOf(rows, key, '2026-10-09')[0].status).toBe('overdue');   // 9 days late, grace 8
    expect(cyclesOf(rows, key, '2026-12-01')[0].status).toBe('lapsed');    // over two cycles late
  });
  it('needs two orders', () => {
    expect(cyclesOf([row({})], key, '2026-10-13')).toEqual([]);
  });
});

describe('customer segments', () => {
  const today = '2026-10-13';
  const orders = (party: string, days: string[], value: number) => days.map((day) => row({ party, day, order_value: value }));
  const rows = [
    ...orders('Champ', ['2026-08-01', '2026-08-15', '2026-09-01', '2026-09-15', '2026-10-01', '2026-10-10'], 10000),
    ...orders('Risky', ['2026-08-01', '2026-08-10', '2026-08-20', '2026-08-25'], 20000),
    ...orders('Lost Co', ['2026-08-02'], 500),
    ...orders('New Co', ['2026-10-05'], 1000),
    ...orders('Mid', ['2026-09-01', '2026-09-20'], 3000),
  ];
  const all = segmentsOf(rows, today, cyclesOf(rows, (r) => partyKey(r.party), today));
  const seg = (p: string) => all.find((c) => c.party === p)!;

  it('puts each plant in the first segment that fits', () => {
    expect(seg('Champ')).toMatchObject({ segment: 'Champion', score: { r: 3, f: 3, m: 3 }, risk: null });
    expect(seg('Risky')).toMatchObject({ segment: 'At risk', daysSince: 49, orders: 4, risk: 'high' });
    expect(seg('Lost Co').segment).toBe('Lost');
    expect(seg('New Co').segment).toBe('New');
    expect(seg('Mid')).toMatchObject({ segment: 'Loyal', risk: null });
  });
  it('splits the last 60 days into two halves', () => {
    expect(seg('Champ')).toMatchObject({ last30: 30000, prev30: 20000 });
  });
  it('flags a sharp drop to watch', () => {
    const drop = [...orders('Drop', ['2026-08-20', '2026-08-30', '2026-09-10', '2026-09-15'], 9000), ...orders('Drop', ['2026-09-20', '2026-10-01'], 1000)];
    const [d] = segmentsOf(drop, today, []);
    expect(d).toMatchObject({ last30: 11000, prev30: 27000, risk: 'watch', why: 'Last 30 days under half of the 30 before' });
  });
  it('sorts by lifetime value', () => {
    expect(all.map((c) => c.party)).toEqual(['Risky', 'Champ', 'Mid', 'New Co', 'Lost Co']);
  });
});

describe('rates', () => {
  const today = '2026-10-13';
  const line = (day: string, quantity: number, rate: number, p: Partial<SepRow> = {}) =>
    row({ day, quantity, rate, order_value: quantity * rate, ...p });

  it('treats placeholder PM codes as missing', () => {
    expect(pmKey(' pm1 ')).toBe('PM1');
    expect([pmKey('00'), pmKey('-'), pmKey('NA'), pmKey(''), pmKey(null)]).toEqual([null, null, null, null, null]);
  });
  it('expects a higher rate on a smaller order', () => {
    const [c] = rateChecksOf([line('2026-09-01', 10000, 2), line('2026-09-20', 1000, 6)], today);
    expect(c).toMatchObject({ low: 2, high: 6, latest: 6, atStake: 0, undercut: null });
  });
  it('flags an order billed lower than an earlier one at least as big', () => {
    const [c] = rateChecksOf([line('2026-09-01', 2000, 5), line('2026-09-20', 2000, 3), line('2026-10-01', 500, 4)], today);
    expect(c.atStake).toBe(2000 * 2 + 500 * 1);
    expect(c.undercut).toMatchObject({ line: { day: '2026-09-20', rate: 3 }, was: { rate: 5 } });
  });
  it('compares orders on the same day too', () => {
    const [c] = rateChecksOf([line('2026-09-17', 550, 2), line('2026-09-17', 650, 6)], today);
    expect(c.atStake).toBe(550 * 4);
  });
  it('checks each party + product apart, and skips one rate or no PM code', () => {
    const checks = rateChecksOf([
      line('2026-09-01', 1000, 2), line('2026-09-02', 1000, 3, { party: 'Other' }),
      line('2026-09-01', 1000, 2, { pm_code: '00' }), line('2026-09-05', 1000, 9, { pm_code: '00' }),
    ], today);
    expect(checks).toEqual([]);
  });
  it('bands the period by labels per order, and lists rows without a PM code', () => {
    const a = analyse([line('2026-10-02', 500, 10), line('2026-10-03', 30000, 1), line('2026-10-04', 800, 12, { pm_code: '0' })],
      { from: '2026-10-01', to: '2026-10-13' }, { unit: null, group: null, party: null }, today);
    expect(a.priceCurve[0]).toMatchObject({ label: 'Under 1K', orders: 2, qty: 1300 });
    expect(a.priceCurve[0].rate).toBeCloseTo((5000 + 9600) / 1300);
    expect(a.priceCurve[5]).toMatchObject({ orders: 1, rate: 1 });
    expect(a.noPmCode.map((r) => r.pm_code)).toEqual(['0']);
  });
});

describe('colour approval', () => {
  const today = '2026-10-13';
  const card = (p: Partial<ShadeCard>): ShadeCard => ({
    id: Math.random().toString(36), party: 'UPL-3', product: 'Box label', pm_code: 'PM1', status: 'Approved',
    prepared: '2026-09-08', sent: '2026-09-09', approved: '2026-09-10', ...p,
  });
  const orders = [
    row({ party: 'UPL - 03', pm_code: 'PM1', day: '2026-09-01', order_value: 5000 }),
    row({ party: 'UPL - 03', pm_code: 'PM2', day: '2026-10-01', order_value: 7000 }),
  ];
  const ap = approvalsOf([
    card({}),                                                                    // PO 1 Sep, card after
    card({ pm_code: 'PM2', prepared: '2026-09-20', sent: '2026-09-21', approved: '2026-09-25' }),  // card first, PO after
    card({ pm_code: 'PM3', status: 'Pending Approval', approved: null, sent: '2026-10-03' }),
    card({ pm_code: 'PM4', sent: null, prepared: '2026-07-01' }),                // before the order book
  ], orders, '2026-08-01', today);

  it('takes the Job Separation spelling of the party', () => {
    expect(ap.cards.every((t) => t.customer === 'UPL - 03')).toBe(true);
  });
  it('matches a card to the order before it, else the first after', () => {
    const [p2, p1] = [ap.cards.find((t) => t.pm_code === 'PM2')!, ap.cards.find((t) => t.pm_code === 'PM1')!];
    expect(p1).toMatchObject({ poDay: '2026-09-01', poValue: 5000, days: 1 });
    expect(p2).toMatchObject({ poDay: '2026-10-01', poValue: 7000 });
  });
  it('skips cards from before the order book and measures the steps', () => {
    expect(ap.cards).toHaveLength(3);
    expect(ap.steps).toMatchObject({ poToCard: { days: 7, n: 1 }, cardToSent: { days: 1, n: 3 }, poToApproved: { days: 9, n: 1 } });
  });
  it('lists what waits on the customer and approved cards with no order', () => {
    expect(ap.waiting.map((t) => [t.pm_code, t.days, t.hasOrder])).toEqual([['PM3', 10, false]]);
    expect(ap.noOrder).toEqual([]);
    expect(ap.byParty).toEqual([{ customer: 'UPL - 03', cards: 3, pending: 1, noOrder: 1, sentToApproved: 2.5 }]);
  });
  it('narrows to a party', () => {
    expect(approvalsOf([card({})], orders, '2026-08-01', today, (c) => c === 'ARYSTA').cards).toEqual([]);
  });
});

describe('product lifecycle and forecast', () => {
  const today = '2026-10-13', start = '2026-08-01';
  const at = (pm: string, day: string, v = 1000) => row({ pm_code: pm, day, order_value: v });
  const rows = [
    at('OLD', '2026-08-02'), at('OLD', '2026-09-01'), at('OLD', '2026-10-01'),   // since the data's start: repeat
    at('ONCE', '2026-08-20', 500),                                                  // one order, long ago
    at('NEW', '2026-10-05', 2000),                                                  // first seen recently
    at('GONE', '2026-08-03'), at('GONE', '2026-08-10'),                            // two orders, then nothing
  ];
  const cycles = cyclesOf(rows, (r) => `${partyKey(r.party)}|${r.pm_code}`, today);
  const life = lifecycleOf(rows, today, start, cycles);
  const stage = (pm: string) => life.products.find((p) => p.pm_code === pm)!.stage;

  it('puts each product in a stage', () => {
    expect([stage('OLD'), stage('ONCE'), stage('NEW'), stage('GONE')]).toEqual(['Reordered', 'Only once', 'New', 'Stopped']);
  });
  it('splits each month into repeat and new-product value', () => {
    expect(life.months.map((m) => [m.label, m.repeat, m.fresh, m.freshProducts])).toEqual([
      ['Aug 2026', 3000, 500, 1], ['Sep 2026', 1000, 0, 0], ['Oct 2026', 1000, 2000, 1],
    ]);
  });
  it('lands reorders on their due weeks and spreads new-product pace evenly', () => {
    const f = forecastOf(rows, today, cycles, life, start);
    expect(f.weeks[0].from).toBe(today);
    // OLD: every 30 days, last 1 Oct → due 31 Oct, in week 3 (10 Nov is past the horizon)
    expect(f.weeks.map((w) => w.orders)).toEqual([0, 0, 1, 0]);
    expect(f.weeks[2].repeat).toBe(1000);
    // New-product first orders since 15 Aug: 500 + 2000 over 8 weeks
    expect(f.freshWeekly).toBeCloseTo(2500 / 8);
    expect(f.recentWeekly).toBe((1000 + 2000) / 4);
  });
});
