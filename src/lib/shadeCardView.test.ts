import { describe, it, expect } from 'vitest';
import { daysWithParty, withPartyLabel, WITH_PARTY_LATE_DAYS } from './shadeCardView';

describe('daysWithParty', () => {
  const now = new Date(2026, 9, 6, 11);
  it('counts whole days since it was sent', () => {
    expect(daysWithParty({ status: 'Pending Approval', sent_to_party_date: '2026-09-27' }, now)).toBe(9);
    expect(daysWithParty({ status: 'Pending Approval', sent_to_party_date: '2026-10-06' }, now)).toBe(0);
  });
  it('is null once answered or never sent', () => {
    expect(daysWithParty({ status: 'Approved', sent_to_party_date: '2026-09-27' }, now)).toBeNull();
    expect(daysWithParty({ status: 'Pending Approval', sent_to_party_date: null }, now)).toBeNull();
  });
  it('labels and threshold', () => {
    expect([0, 1, 9].map(withPartyLabel)).toEqual(['today', '1 day', '9 days']);
    expect(WITH_PARTY_LATE_DAYS).toBe(5);
  });
});
