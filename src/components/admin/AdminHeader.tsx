'use client';
// src/components/admin/AdminHeader.tsx

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Package, Scissors, Disc, Users, SplitSquareHorizontal, Contact, ClipboardList, Truck, Menu, X, Building2, LayoutDashboard, Printer, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import {
  canDeptUseBOM,
  canDeptManageDispatchNotifications,
  canDeptManagePartyContacts,
  canDeptManageRegister,
  canDeptManageTeam,
  canDeptManageNotificationRecipients,
  canDeptExportData,
  type DeptPermissions,
} from '@/lib/constants/departments';
import { Logo } from '@/components/brand/Logo';
import ExportButton from './ExportButton';

type Props = {
  dept:        DeptPermissions;
  displayName: string;
};

// How often the header re-checks for material requests nobody has answered.
// Slow on purpose: this is a badge, not a wall display, and it rides the
// count-only branch of the API so it never pulls the request bodies.
const BOM_BADGE_POLL_MS = 60_000;

type NavItem = {
  href:   string;
  label:  string;
  icon:   LucideIcon;
  /** Unanswered-work count; rendered as an amber pill when > 0. */
  badge?: number;
  /** Spoken form of the badge, e.g. "3 requests awaiting a decision". */
  badgeLabel?: (n: number) => string;
};

/** Is `href` the section the user is currently in?
 *  /admin is the dashboard itself, so it only matches exactly — otherwise it
 *  would light up on every child route and two entries would read as active. */
function isActive(pathname: string, href: string) {
  return href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);
}

/** One nav entry, in either of the header's two layouts.
 *
 *  Both lists render from the same NAV model through this component. The
 *  desktop and mobile navs used to be eighteen hand-copied <Link> blocks, and
 *  that duplication is exactly why the active state was never applied: there
 *  was no single place to put it. Anything added here shows up in both. */
function NavLink({
  item, pathname, variant,
}: {
  item:     NavItem;
  pathname: string;
  variant:  'desk' | 'mobile';
}) {
  const active = isActive(pathname, item.href);
  const Icon   = item.icon;
  const n      = item.badge ?? 0;

  return (
    <Link
      href={item.href}
      title={item.label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative inline-flex items-center gap-1.5 rounded-lg transition-colors whitespace-nowrap',
        variant === 'desk'
          ? 'px-2.5 py-1.5 text-xs font-medium'
          : 'flex w-full gap-2.5 min-h-11 px-2 text-sm font-medium',
        // The active entry reads by fill plus full-strength text. The fill is
        // an area cue rather than a colour one, so it still separates for
        // anyone who cannot tell white/75 from white; aria-current above
        // carries it for assistive tech.
        active
          ? 'bg-white/15 text-white'
          : cn(
              'hover:bg-white/10 hover:text-white',
              variant === 'desk' ? 'text-white/75' : 'text-white/85',
            ),
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {item.label}
      {n > 0 && (
        <span
          className="ml-0.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-amber-300 px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-[#0A1F18]"
          aria-label={item.badgeLabel?.(n)}
        >
          {n}
        </span>
      )}
    </Link>
  );
}

export default function AdminHeader({ dept, displayName }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = createClient();
  const queryClient = useQueryClient();

  // Below lg, the link list is replaced by this hamburger toggle — closes
  // itself on every navigation so it never lingers open over the next page.
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Bill of Material requests still awaiting the owner. Only Production and
  // Admin can see the section at all, so nobody else even asks.
  const showBom = canDeptUseBOM(dept);

  // React Query owns the poll now: refetchInterval already skips firing
  // while the tab is in the background (matching the old manual
  // document.visibilityState check), and a failed poll just leaves the
  // last successful count on screen rather than resetting to 0 — a badge
  // is not worth a toast.
  const { data: bomPending = 0 } = useQuery({
    queryKey: ['bom-requests', 'pending-count'],
    queryFn: async () => {
      const res = await fetch('/api/bom-requests?count=pending');
      if (!res.ok) throw new Error('Failed to load pending BOM count');
      const data = await res.json();
      return data.pending ?? 0;
    },
    enabled: showBom,
    refetchInterval: BOM_BADGE_POLL_MS,
  });

  // Parties with a dispatch batch still waiting to be emailed. Only
  // Dispatch/Admin manage this queue — same poll cadence as the BOM badge.
  const canQueue = canDeptManageDispatchNotifications(dept);

  // Dispatch Emails now also holds the party-contact and internal-recipient
  // lists as tabs, so the entry has to show for anyone holding any of the
  // three keys — an Admin who manages recipients but not the queue would
  // otherwise have no way in. The badge stays gated on the queue permission
  // alone, since /api/dispatch-notifications refuses anyone else.
  const showDispatchEmails =
    canQueue || canDeptManagePartyContacts(dept) || canDeptManageNotificationRecipients(dept);

  const { data: dispatchPending = 0 } = useQuery({
    queryKey: ['dispatch-notifications', 'pending-count'],
    queryFn: async () => {
      const res = await fetch('/api/dispatch-notifications');
      if (!res.ok) throw new Error('Failed to load pending dispatch count');
      const data = await res.json();
      return data.groups?.length ?? 0;
    },
    enabled: canQueue,
    refetchInterval: BOM_BADGE_POLL_MS,
  });

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();

      // Ctrl+K focuses whatever search box is on the current page — every
      // admin page tags its own search input with data-global-search, so
      // there is at most one match at a time.
      if (key === 'k') {
        e.preventDefault();
        const search = document.querySelector<HTMLInputElement>('[data-global-search]');
        search?.focus();
        search?.select();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [router]);

  // The single source of truth for both navs. Permission gates live here
  // rather than beside the markup, so desktop and mobile can never drift on
  // who is allowed to see what.
  //
  // Dashboard leads: it had no entry at all before, reachable only by clicking
  // the logo — which is why ten sub-pages each grew their own "Back to
  // dashboard" link to compensate.
  const navItems: NavItem[] = [
    { href: '/admin',                label: 'Dashboard',      icon: LayoutDashboard },
    { href: '/admin/stock',          label: 'Label Stock',    icon: Package },
    { href: '/admin/slips',          label: 'Slips',          icon: Printer },
    { href: '/admin/dies',           label: 'Dies',           icon: Scissors },
    { href: '/admin/plates',         label: 'Plates',         icon: Disc },
    { href: '/admin/job-separation', label: 'Job Separation', icon: SplitSquareHorizontal },
    // Bill of Material — Production raises material requests here and Admin
    // answers them. Production + Admin only, mirrored by canDeptUseBOM in
    // every /api/bom-requests route and by RLS on the bom_* tables. The badge
    // counts requests nobody has acted on yet.
    ...(showBom ? [{
      href: '/admin/bom', label: 'BOM', icon: ClipboardList,
      badge: bomPending,
      badgeLabel: (n: number) => `${n} request${n === 1 ? '' : 's'} awaiting a decision`,
    }] : []),
    // Consolidated dispatch email queue — Dispatch/Admin only, mirrored by
    // canDeptManageDispatchNotifications in every /api/dispatch-notifications
    // route and by RLS on pending_dispatch_notifications. The badge counts
    // parties with an unsent batch waiting.
    ...(showDispatchEmails ? [{
      href: '/admin/dispatch-notifications', label: 'Dispatch Emails', icon: Truck,
      badge: dispatchPending,
      badgeLabel: (n: number) => `${n} part${n === 1 ? 'y' : 'ies'} with an unsent dispatch email`,
    }] : []),
    // Follow-ups (customer CRM) holds sales/contact data with no reason to be
    // shop-floor-visible — Admin only, mirrored by canDeptManageRegister in
    // every /api/register route and by RLS on the register_* tables. Ordered
    // before Team on request.
    ...(canDeptManageRegister(dept)
      ? [{ href: '/admin/register', label: 'Follow-ups', icon: Contact }] : []),
    // Team management touches login accounts directly — Admin only, mirrored
    // by the check in every /api/team route.
    ...(canDeptManageTeam(dept)
      ? [{ href: '/admin/team', label: 'Team', icon: Users }] : []),
    // Create departments and configure their permission grids — the
    // super-admin department only, since this page edits the permission
    // system itself.
    ...(dept.isSuperAdmin
      ? [{ href: '/admin/departments', label: 'Departments', icon: Building2 }] : []),
  ];

  async function handleLogout() {
    await supabase.auth.signOut();
    // Drop every cached response — this is a shared shop-floor terminal, and
    // whoever logs in next must not see a moment of the previous
    // department's job/stock/BOM data from the query cache.
    queryClient.clear();
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="bg-brand-header sticky top-0 z-40 border-b border-white/10">
      <div className="max-w-screen-2xl 3xl:max-w-[1800px] 4xl:max-w-[2200px] mx-auto px-4 h-14 flex items-center justify-between">

        {/* Brand + primary nav */}
        <div className="flex items-center gap-3 sm:gap-5 min-w-0">
          <Link href="/admin" aria-label="Go to dashboard" title="Dashboard" className="shrink-0">
            <Logo onDark width={120} height={30} priority />
          </Link>

          {/* Label stock, dies, plates and job separation are readable by
              every department — Dispatch (stock) and Prepress (dies/plates/
              job separation) are the only ones who can change them, enforced
              in /api/stock, /api/dies, /api/plates, /api/job-separations. */}
          {/* Label stock, dies, plates and job separation are readable by
              every department — Dispatch (stock) and Prepress (dies/plates/
              job separation) are the only ones who can change them, enforced
              in /api/stock, /api/dies, /api/plates, /api/job-separations. */}
          <nav aria-label="Admin sections" className="hidden lg:flex items-center">
            {navItems.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} variant="desk" />
            ))}
          </nav>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          <span className="text-white/75 text-xs font-mono hidden sm:inline">
            {displayName}
          </span>
          {/* Full-database export — Admin only, mirrored by the check in
              GET /api/export, which is the actual gate. */}
          {canDeptExportData(dept) && <ExportButton />}
          {/* Below md this moves into the hamburger panel instead, sized for
              a proper tap target there — this compact text button stays
              desktop-only. */}
          <button
            onClick={handleLogout}
            className="hidden lg:inline-block text-white/70 hover:text-white text-xs transition-colors px-2 py-1"
          >
            Sign out
          </button>

          {/* Hamburger toggle — below lg, this is the only way to reach the
              section links, so it needs a real 44px tap target. */}
          <button
            type="button"
            onClick={() => setMobileOpen((open) => !open)}
            aria-expanded={mobileOpen}
            aria-controls="admin-mobile-nav"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            className="lg:hidden inline-flex items-center justify-center min-h-11 min-w-11 -mr-2 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors"
          >
            {mobileOpen
              ? <X className="h-5 w-5" aria-hidden="true" />
              : <Menu className="h-5 w-5" aria-hidden="true" />}
          </button>
        </div>
      </div>

      {/* Mobile section list — same links/conditions as the desktop nav
          above, just stacked with full-width 44px rows instead of an
          inline strip. lg:hidden as a second guard so a resize past lg
          hides it even if mobileOpen is still true from a smaller width. */}
      {mobileOpen && (
        <nav
          id="admin-mobile-nav"
          aria-label="Admin sections (mobile)"
          className="lg:hidden border-t border-white/10 bg-brand-header px-4 py-2"
        >
          {navItems.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} variant="mobile" />
          ))}

          <div className="mt-1 pt-2 border-t border-white/10 flex items-center justify-between">
            <span className="text-white/75 text-xs font-mono px-2">{displayName}</span>
            <button
              onClick={handleLogout}
              className="min-h-11 px-3 rounded-lg text-sm font-medium text-white/85 hover:text-white hover:bg-white/10 transition-colors"
            >
              Sign out
            </button>
          </div>
        </nav>
      )}
    </header>
  );
}
