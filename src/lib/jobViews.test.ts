import { describe, it, expect } from 'vitest';
import {
  istToday, daysBetween, daysToDelivery, needsAttention, dueThisWeek,
  attentionCompare, deliveryWords,
} from './jobViews';
import type { Job } from '@/lib/types';

const TODAY = '2026-10-03';

function job(p: Partial<Job>): Job {
  return {
    id: p.id ?? 'x', status: 'In Printing', delivery_date: null,
    urgent: false, urgent_priority: null, ...p,
  } as Job;
}

describe('istToday', () => {
  it('uses IST, not UTC — 20:00 UTC is already the next day in India', () => {
    expect(istToday(new Date('2026-10-03T20:00:00Z'))).toBe('2026-10-04');
  });
});

describe('daysBetween', () => {
  it('counts across a month and a year boundary', () => {
    expect(daysBetween('2026-09-30', '2026-10-02')).toBe(2);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2026-10-03', '2026-09-30')).toBe(-3);
  });
});

describe('daysToDelivery', () => {
  it('is null without a date, or once dispatched or closed', () => {
    expect(daysToDelivery(job({}), TODAY)).toBeNull();
    expect(daysToDelivery(job({ delivery_date: '2026-09-01', status: 'Dispatched' }), TODAY)).toBeNull();
    expect(daysToDelivery(job({ delivery_date: '2026-09-01', status: 'PO Closed' }), TODAY)).toBeNull();
  });
  it('tolerates a timestamp-shaped date', () => {
    expect(daysToDelivery(job({ delivery_date: '2026-10-05T00:00:00+00:00' }), TODAY)).toBe(2);
  });
});

describe('needsAttention / dueThisWeek', () => {
  it('flags late, held and urgent jobs only', () => {
    expect(needsAttention(job({ delivery_date: '2026-10-01' }), TODAY)).toBe(true);
    expect(needsAttention(job({ status: 'On Hold' }), TODAY)).toBe(true);
    expect(needsAttention(job({ urgent: true }), TODAY)).toBe(true);
    expect(needsAttention(job({ delivery_date: '2026-10-03' }), TODAY)).toBe(false);
  });
  it('a dispatched job is never late', () => {
    expect(needsAttention(job({ delivery_date: '2026-09-01', status: 'Dispatched' }), TODAY)).toBe(false);
  });
  it('due this week is today through six days out', () => {
    expect(dueThisWeek(job({ delivery_date: '2026-10-03' }), TODAY)).toBe(true);
    expect(dueThisWeek(job({ delivery_date: '2026-10-09' }), TODAY)).toBe(true);
    expect(dueThisWeek(job({ delivery_date: '2026-10-10' }), TODAY)).toBe(false);
    expect(dueThisWeek(job({ delivery_date: '2026-10-02' }), TODAY)).toBe(false);
  });
});

describe('attentionCompare', () => {
  it('orders most late, then urgent by priority, then held', () => {
    const list = [
      job({ id: 'held', status: 'On Hold' }),
      job({ id: 'p2', urgent: true, urgent_priority: 2 }),
      job({ id: 'late1', delivery_date: '2026-10-02' }),
      job({ id: 'p1', urgent: true, urgent_priority: 1 }),
      job({ id: 'late5', delivery_date: '2026-09-28' }),
    ];
    expect(list.sort(attentionCompare(TODAY)).map((j) => j.id))
      .toEqual(['late5', 'late1', 'p1', 'p2', 'held']);
  });
});

describe('deliveryWords', () => {
  it('reads like the floor talks', () => {
    expect(deliveryWords(job({ delivery_date: '2026-10-02' }), TODAY)).toEqual({ text: '1 day late', tone: 'late' });
    expect(deliveryWords(job({ delivery_date: '2026-09-30' }), TODAY)).toEqual({ text: '3 days late', tone: 'late' });
    expect(deliveryWords(job({ delivery_date: '2026-10-03' }), TODAY).text).toBe('today');
    expect(deliveryWords(job({ delivery_date: '2026-10-04' }), TODAY).text).toBe('tomorrow');
    expect(deliveryWords(job({ delivery_date: '2026-10-05' }), TODAY)).toEqual({ text: 'in 2 days', tone: 'soon' });
    expect(deliveryWords(job({ delivery_date: '2026-10-08' }), TODAY)).toEqual({ text: 'in 5 days', tone: 'ok' });
    expect(deliveryWords(job({}), TODAY).tone).toBe('none');
  });
});
