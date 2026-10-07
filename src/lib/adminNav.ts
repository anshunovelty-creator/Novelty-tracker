// src/lib/adminNav.ts
// ============================================================
// The admin header's sections, grouped the way the floor thinks about them:
// Dashboard, Job Separation, Production, Shade Cards, Stock, Dispatch, then
// BOM, Follow-ups and Reports. Team, Departments and Settings sit behind the gear.
//
// One function decides who sees what, so the header strip, the phone sheet,
// the phone tab bar and Ctrl+K can never disagree. Permission gates mirror
// the API routes, which remain the real check.
// ============================================================

import type { LucideIcon } from 'lucide-react';
import {
  BarChart3, Building2, ClipboardList, Contact, Cpu, Disc, LayoutDashboard, Package,
  Palette, Printer, Scissors, Settings, SplitSquareHorizontal, Truck, Users,
} from 'lucide-react';
import {
  canDeptUseBOM,
  canDeptManageDispatchNotifications,
  canDeptManagePartyContacts,
  canDeptManageRegister,
  canDeptManageTeam,
  canDeptManageNotificationRecipients,
  canDeptViewStock,
  type DeptPermissions,
} from '@/lib/constants/departments';

export type NavLink = {
  href:   string;
  label:  string;
  icon:   LucideIcon;
  /** Unanswered-work count; shown as an amber pill when > 0. */
  badge?: number;
  /** Spoken form of the badge, e.g. "3 requests awaiting a decision". */
  badgeLabel?: (n: number) => string;
};

export type NavGroup = {
  key:   string;
  label: string;
  icon:  LucideIcon;
  items: NavLink[];
  /** Extra path prefixes that belong to this group without a menu entry
   *  (a job's own page lives under Jobs). */
  also?: string[];
};

export type NavCounts = { bomPending?: number; dispatchPending?: number };

/** Is `href` the page the user is on? /admin only matches exactly. */
export function isActiveHref(pathname: string, href: string): boolean {
  return href === '/admin' ? pathname === '/admin' : pathname === href || pathname.startsWith(`${href}/`);
}

export function isGroupActive(pathname: string, group: NavGroup): boolean {
  return group.items.some((i) => isActiveHref(pathname, i.href))
    || (group.also ?? []).some((p) => isActiveHref(pathname, p));
}

/** Sum of the badges inside a group — what its closed tab shows. */
export function groupBadge(group: NavGroup): number {
  return group.items.reduce((n, i) => n + Math.max(0, i.badge ?? 0), 0);
}

export function buildNavGroups(dept: DeptPermissions, counts: NavCounts = {}): NavGroup[] {
  const showDispatchEmails =
    canDeptManageDispatchNotifications(dept) || canDeptManagePartyContacts(dept) || canDeptManageNotificationRecipients(dept);

  const groups: NavGroup[] = [
    // Dashboard and Job Separation are each a tab of their own (one-item
    // groups render as plain links). A job's own page lights Dashboard.
    {
      key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, also: ['/admin/jobs'],
      items: [{ href: '/admin', label: 'Dashboard', icon: LayoutDashboard }],
    },
    {
      key: 'jobseparation', label: 'Job Separation', icon: SplitSquareHorizontal,
      items: [{ href: '/admin/job-separation', label: 'Job Separation', icon: SplitSquareHorizontal }],
    },
    {
      // Dies and plates are readable by every department; Prepress alone
      // changes them (enforced in their API routes).
      key: 'production', label: 'Production', icon: Cpu,
      items: [
        { href: '/admin/machines', label: 'Machines', icon: Cpu },
        { href: '/admin/plates',   label: 'Plates',   icon: Disc },
        { href: '/admin/dies',     label: 'Dies',     icon: Scissors },
      ],
    },
    {
      // Its own tab: readable by every department, changed by Prepress.
      key: 'shadecards', label: 'Shade Cards', icon: Palette,
      items: [{ href: '/admin/shade-cards', label: 'Shade Cards', icon: Palette }],
    },
    {
      key: 'stock', label: 'Stock', icon: Package,
      items: canDeptViewStock(dept)
        ? [{ href: '/admin/stock', label: 'Label Stock', icon: Package }]
        : [],
    },
    {
      key: 'dispatch', label: 'Dispatch', icon: Truck,
      items: [
        { href: '/admin/slips', label: 'Slips', icon: Printer },
        ...(showDispatchEmails ? [{
          href: '/admin/dispatch-notifications', label: 'Dispatch Emails', icon: Truck,
          // The count is only fetched for the queue's own permission holders.
          badge: canDeptManageDispatchNotifications(dept) ? counts.dispatchPending : undefined,
          badgeLabel: (n: number) => `${n} part${n === 1 ? 'y' : 'ies'} with an unsent dispatch email`,
        }] : []),
      ],
    },
    {
      key: 'bom', label: 'BOM', icon: ClipboardList,
      items: canDeptUseBOM(dept) ? [{
        href: '/admin/bom', label: 'BOM', icon: ClipboardList,
        badge: counts.bomPending,
        badgeLabel: (n: number) => `${n} material request${n === 1 ? '' : 's'} awaiting Admin`,
      }] : [],
    },
    {
      key: 'followups', label: 'Follow-ups', icon: Contact,
      items: canDeptManageRegister(dept) ? [{ href: '/admin/register', label: 'Follow-ups', icon: Contact }] : [],
    },
    {
      key: 'reports', label: 'Reports', icon: BarChart3,
      items: dept.isSuperAdmin ? [{ href: '/admin/reports', label: 'Reports', icon: BarChart3 }] : [],
    },
  ];

  return groups.filter((g) => g.items.length > 0);
}

/** The gear: pages that configure the app rather than run production. */
export function buildAdminLinks(dept: DeptPermissions): NavLink[] {
  return [
    ...(canDeptManageTeam(dept) ? [{ href: '/admin/team', label: 'Team', icon: Users }] : []),
    ...(dept.isSuperAdmin ? [
      { href: '/admin/departments', label: 'Departments', icon: Building2 },
      { href: '/admin/settings',    label: 'Settings',    icon: Settings },
    ] : []),
  ];
}
