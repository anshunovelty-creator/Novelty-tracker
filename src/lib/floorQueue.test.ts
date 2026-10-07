import { describe, expect, it } from 'vitest';
import { floorQueue, isReadyToPrint } from './floorQueue';
import type { Job } from './types';

const job = (o: Partial<Job>): Job => ({
  id: Math.random().toString(36), status: 'Job Card Done', job_type: 'New', is_closed: false,
  is_scheduled_release: false, urgent: false, urgent_priority: null, delivery_date: null,
  printing_method: 'Flexo', ...o,
} as Job);

describe('isReadyToPrint', () => {
  it('needs an approved shade card for a New job', () => {
    expect(isReadyToPrint(job({ status: 'Shade Card Approved' }))).toBe(true);
    expect(isReadyToPrint(job({ status: 'Job Card Done' }))).toBe(false);
  });
  it('only needs the job card for a Repeat', () => {
    expect(isReadyToPrint(job({ job_type: 'Repeat', status: 'Job Card Done' }))).toBe(true);
  });
  it('leaves scheduled releases and closed jobs out', () => {
    expect(isReadyToPrint(job({ status: 'Shade Card Approved', is_scheduled_release: true }))).toBe(false);
    expect(isReadyToPrint(job({ status: 'Shade Card Approved', is_closed: true }))).toBe(false);
  });
});

describe('floorQueue', () => {
  it('puts urgent first, then the nearest delivery', () => {
    const a = job({ status: 'Shade Card Approved', delivery_date: '2026-10-09' });
    const b = job({ status: 'Shade Card Approved', delivery_date: '2026-10-06' });
    const c = job({ status: 'Shade Card Approved', urgent: true, urgent_priority: 2 });
    const d = job({ status: 'Shade Card Approved', urgent: true, urgent_priority: 1, delivery_date: '2026-12-01' });
    expect(floorQueue([a, b, c, d], () => true).ready).toEqual([d, c, b, a]);
  });
  it('keeps jobs this department cannot print out of both lists', () => {
    const offset = job({ status: 'In Printing', printing_method: 'Offset' });
    const flexo  = job({ status: 'In Printing', printing_method: 'Flexo' });
    expect(floorQueue([offset, flexo], (j) => j.printing_method === 'Flexo').running).toEqual([flexo]);
  });
});
