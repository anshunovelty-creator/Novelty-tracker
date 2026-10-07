import { describe, it, expect, vi } from 'vitest';

// departments.ts pulls in the service-role client for its cache; the helpers
// under test never touch it.
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));

import { buildNavGroups, buildAdminLinks, isActiveHref, isGroupActive, groupBadge } from './adminNav';
import type { DeptPermissions } from '@/lib/constants/departments';

const dept = (over: Partial<DeptPermissions> = {}): DeptPermissions => ({
  key: 'production', displayName: 'Production', clientFacingName: 'Production',
  isSuperAdmin: false, isReadOnly: false, allStages: false, printingMethodScope: null,
  features: [], stages: [], runStages: [], ...over,
});

const keys = (d: DeptPermissions) => buildNavGroups(d).map((g) => g.key);

describe('buildNavGroups', () => {
  it('gives Admin every group in the design order', () => {
    expect(keys(dept({ isSuperAdmin: true }))).toEqual(['dashboard', 'jobseparation', 'production', 'shadecards', 'stock', 'dispatch', 'bom', 'followups', 'reports']);
  });

  it('drops groups a department has nothing in', () => {
    expect(keys(dept())).toEqual(['dashboard', 'jobseparation', 'production', 'shadecards', 'dispatch']);
  });

  it('adds Stock and BOM when the department holds those features', () => {
    expect(keys(dept({ features: ['stock_view', 'bom_use'] }))).toEqual(['dashboard', 'jobseparation', 'production', 'shadecards', 'stock', 'dispatch', 'bom']);
  });

  it('passes the badge counts through to the right entries', () => {
    const g = buildNavGroups(dept({ isSuperAdmin: true }), { bomPending: 2, dispatchPending: 3 });
    expect(groupBadge(g.find((x) => x.key === 'bom')!)).toBe(2);
    expect(groupBadge(g.find((x) => x.key === 'dispatch')!)).toBe(3);
    expect(groupBadge(g.find((x) => x.key === 'dashboard')!)).toBe(0);
  });
});

describe('buildAdminLinks', () => {
  it('is empty for a floor department', () => expect(buildAdminLinks(dept())).toEqual([]));
  it('holds Team, Departments and Settings for Admin', () => {
    expect(buildAdminLinks(dept({ isSuperAdmin: true })).map((l) => l.label)).toEqual(['Team', 'Departments', 'Settings']);
  });
});

describe('active matching', () => {
  it('matches /admin only exactly', () => {
    expect(isActiveHref('/admin', '/admin')).toBe(true);
    expect(isActiveHref('/admin/dies', '/admin')).toBe(false);
  });
  it('does not confuse a prefix with a sibling route', () => {
    expect(isActiveHref('/admin/stocktake', '/admin/stock')).toBe(false);
    expect(isActiveHref('/admin/stock/123', '/admin/stock')).toBe(true);
  });
  it('lights Dashboard on a job detail page and Production on Machines', () => {
    const g = buildNavGroups(dept({ isSuperAdmin: true }));
    expect(isGroupActive('/admin/jobs/abc', g.find((x) => x.key === 'dashboard')!)).toBe(true);
    expect(isGroupActive('/admin/machines', g.find((x) => x.key === 'production')!)).toBe(true);
    expect(isGroupActive('/admin/machines', g.find((x) => x.key === 'dashboard')!)).toBe(false);
    expect(isGroupActive('/admin/shade-cards/1', g.find((x) => x.key === 'shadecards')!)).toBe(true);
  });
});
