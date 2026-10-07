import { describe, it, expect } from 'vitest';
import { isNightHour } from './nightHours';

describe('isNightHour', () => {
  it('uses IST: 13:29 UTC is 18:59 IST (day), 13:30 UTC is 19:00 IST (night)', () => {
    expect(isNightHour(new Date('2026-10-05T13:29:00Z'))).toBe(false);
    expect(isNightHour(new Date('2026-10-05T13:30:00Z'))).toBe(true);
  });
  it('lifts at 07:00 IST', () => {
    expect(isNightHour(new Date('2026-10-06T01:29:00Z'))).toBe(true);   // 06:59 IST
    expect(isNightHour(new Date('2026-10-06T01:30:00Z'))).toBe(false);  // 07:00 IST
  });
});
