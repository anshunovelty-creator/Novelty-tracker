// src/lib/sort.test.ts
// Month-coded serials (Job Separation Sr. No 'AUG26-12', job card
// 'aug26-12') must sort by calendar month then sequence — never
// alphabetically, and never ignoring the year at a December rollover.

import { describe, expect, it } from 'vitest';
import { compareValues, parseMonthCode } from './sort';

const sortCodes = (codes: (string | null)[], dir: 'asc' | 'desc' = 'asc') =>
  [...codes].sort((a, b) => {
    const diff = compareValues(a, b, 'month-code');
    return dir === 'asc' ? diff : -diff;
  });

describe('parseMonthCode', () => {
  it('reads month, year and sequence, case-insensitively', () => {
    expect(parseMonthCode('AUG26-12')).toEqual({ period: 26 * 12 + 7, seq: 12 });
    expect(parseMonthCode('aug26-12')).toEqual(parseMonthCode('AUG26-12'));
  });

  it('returns null for anything not in MonYY-N form', () => {
    expect(parseMonthCode(null)).toBeNull();
    expect(parseMonthCode('')).toBeNull();
    expect(parseMonthCode('XYZ26-1')).toBeNull();
    expect(parseMonthCode('IMPORT-7')).toBeNull();
  });
});

describe("compareValues 'month-code'", () => {
  it('orders months by the calendar, not the alphabet', () => {
    expect(sortCodes(['OCT26-1', 'SEP26-1', 'AUG26-1'])).toEqual(['AUG26-1', 'SEP26-1', 'OCT26-1']);
    expect(sortCodes(['AUG26-1', 'OCT26-1', 'SEP26-1'], 'desc')).toEqual(['OCT26-1', 'SEP26-1', 'AUG26-1']);
  });

  it('rolls over the year: DEC26 before JAN27, and the year outranks the month', () => {
    expect(sortCodes(['JAN27-1', 'DEC26-5', 'FEB27-2', 'NOV26-9'])).toEqual(
      ['NOV26-9', 'DEC26-5', 'JAN27-1', 'FEB27-2'],
    );
    expect(sortCodes(['SEP26-1', 'APR27-1'])).toEqual(['SEP26-1', 'APR27-1']);
    expect(sortCodes(['DEC26-1', 'JAN27-1'], 'desc')).toEqual(['JAN27-1', 'DEC26-1']);
  });

  it('orders the sequence numerically within a month', () => {
    expect(sortCodes(['AUG26-10', 'AUG26-2', 'AUG26-1'])).toEqual(['AUG26-1', 'AUG26-2', 'AUG26-10']);
  });

  it('puts hand-pinned codes after parseable ones, and nulls last', () => {
    expect(sortCodes([null, 'IMPORT-7', 'SEP26-1', 'AUG26-3'])).toEqual(['AUG26-3', 'SEP26-1', 'IMPORT-7', null]);
  });
});
