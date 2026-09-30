// src/lib/api/paperStockGate.test.ts
// positive() — the metres guard in front of every /api/paper-stock issue,
// return and receive. The auth half of the module needs Supabase and
// Next's request scope, so those imports are stubbed; only the pure
// helper is exercised.

import { describe, expect, it, vi } from 'vitest';
import { positive } from './paperStockGate';

// Hoisted above the import by vitest.
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock('@/lib/supabase/claims', () => ({ getClaimsUser: vi.fn() }));
vi.mock('@/lib/constants/departments', () => ({
  getDeptPermissions: vi.fn(), canDeptUseBOM: vi.fn(), canDeptManagePaperStock: vi.fn(),
}));

describe('positive', () => {
  it('numbers and numeric strings above 0', () => {
    expect(positive(2794)).toBe(2794);
    expect(positive('500')).toBe(500);
    expect(positive('0.5')).toBe(0.5);
  });

  it('rounds to 2 dp', () => {
    expect(positive(1349.604)).toBe(1349.6);
    expect(positive('94.126')).toBe(94.13);
  });

  it('null for missing, zero, negative, not-a-number and infinite', () => {
    for (const v of [null, undefined, '', 0, '0', -5, '-5', 'abc', NaN, Infinity, '1,000']) {
      expect(positive(v)).toBeNull();
    }
  });

  it('a value that rounds to 0.00 still passes as 0', () => {
    // Current behaviour: 0.001 > 0, so it passes, then rounds to 0 — the
    // route would issue / return 0 m. The stock functions in the database
    // are the backstop.
    expect(positive(0.001)).toBe(0);
  });

  it('Number() coercion lets booleans and one-element arrays through', () => {
    // Current behaviour, documented rather than changed: a JSON body of
    // { "meters": true } or { "meters": ["5"] } is read as 1 and 5.
    expect(positive(true)).toBe(1);
    expect(positive(['5'])).toBe(5);
    expect(positive(false)).toBeNull();
  });
});
