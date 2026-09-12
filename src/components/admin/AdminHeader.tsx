'use client';
// src/components/admin/AdminHeader.tsx

import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Package, Scissors, Disc, Users, SplitSquareHorizontal, Contact, ClipboardList, Truck, Menu, X, Building2, LayoutDashboard, Printer, Palette, type LucideIcon } from 'lucide-react';
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

/** How the section strip is currently drawn. The header steps down this
 *  ladder one rung at a time, and only when the rung above genuinely no
 *  longer fits:
 *
 *    full  — every section with its full name. The normal state.
 *    short — abbreviated names ("Label Stock" → "Stock"). Still readable
 *            words, just less of them.
 *    icon  — symbols alone, with the name on hover and for screen readers.
 *    menu  — even the icons collide, so the strip gives up its space to the
 *            hamburger the small screens already use.
 *
 *  The whole strip moves together: one decisive change at one width, rather
 *  than twelve items independently popping in and out as you drag. */
type Density = typeof DENSITY_LADDER[number] | 'menu';

const DENSITY_LADDER = ['full', 'short', 'icon'] as const;

/** Extra room a wider rung must clear before the strip climbs back to it.
 *  Without this margin a viewport sitting exactly on a threshold — or a
 *  scrollbar appearing on the page below — would flip between two rungs on
 *  every stray pixel. Growing costs 24px more than shrinking. */
const DENSITY_HYSTERESIS = 24;

type NavItem = {
  href:   string;
  label:  string;
  /** Name used on the `short` rung. Omit where the full name is already as
   *  tight as it goes — "Dies" has nothing to give. */
  short?: string;
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

function labelFor(item: NavItem, density: Density) {
  return density === 'short' ? item.short ?? item.label : item.label;
}

/** The shape of a strip entry, at one rung of the ladder.
 *
 *  Shared by the real links and by the hidden rulers that decide which rung
 *  we are on, so what gets measured is exactly what gets rendered — the whole
 *  ladder is only as honest as that pairing. */
function entryClass(density: Density, active: boolean) {
  return cn(
    'relative inline-flex shrink-0 items-center rounded-lg py-1.5 text-xs font-medium',
    // Icons alone want square padding; a name beside them wants breathing
    // room on either side of the pair.
    density === 'icon' ? 'px-2' : 'gap-1.5 px-2.5',
    // Colour is the only thing that moves on hover. The active cue is the
    // sliding underline, which lives outside the entry.
    'transition-colors duration-200 ease-out',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70',
    active ? 'text-white' : 'text-white/70 hover:bg-white/10 hover:text-white',
  );
}

/** Unanswered-work marker. A counted pill where there is room for one, and a
 *  corner dot on the icon rung where there is not — the count is still one
 *  hover away, and losing it is better than the icons colliding. */
function NavBadge({ item, density }: { item: NavItem; density: Density }) {
  const n = item.badge ?? 0;
  if (n <= 0) return null;

  if (density === 'icon') {
    return (
      <span
        className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-300 ring-2 ring-[#10553F]"
        aria-label={item.badgeLabel?.(n)}
      />
    );
  }
  return (
    <span
      className="ml-0.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-amber-300 px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-[#0A1F18]"
      aria-label={item.badgeLabel?.(n)}
    >
      {n}
    </span>
  );
}

/** One section link in the stacked sheet — full-width 44px rows, always with
 *  the full name. The sheet has vertical room, so it never abbreviates. */
function StackedNavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(pathname, item.href);
  const Icon   = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex w-full min-h-11 items-center gap-2.5 rounded-lg px-2 text-sm font-medium',
        'transition-colors duration-200 ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70',
        // The active entry reads by fill plus full-strength text. The fill is
        // an area cue rather than a colour one, so it still separates for
        // anyone who cannot tell white/85 from white; aria-current above
        // carries it for assistive tech.
        active ? 'bg-white/15 text-white' : 'text-white/85 hover:bg-white/10 hover:text-white',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="flex-1">{item.label}</span>
      <NavBadge item={item} density="full" />
    </Link>
  );
}

export default function AdminHeader({ dept, displayName }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = createClient();
  const queryClient = useQueryClient();

  const [mobileOpen, setMobileOpen] = useState(false);
  // Every navigation closes the sheet so it never lingers over the next page.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Material requests still awaiting the owner. Only Production and Admin
  // can see the section at all, so nobody else even asks.
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

  // The single source of truth for the strip and the sheet. Permission gates
  // live here rather than beside the markup, so the two can never drift on
  // who is allowed to see what.
  //
  // Dashboard leads: it had no entry at all before, reachable only by clicking
  // the logo — which is why ten sub-pages each grew their own "Back to
  // dashboard" link to compensate.
  //
  // Label stock, dies, plates and job separation are readable by every
  // department — Dispatch (stock) and Prepress (dies/plates/job separation)
  // are the only ones who can change them, enforced in /api/stock, /api/dies,
  // /api/plates, /api/job-separations.
  const navItems: NavItem[] = [
    { href: '/admin',                label: 'Dashboard',                       icon: LayoutDashboard },
    { href: '/admin/stock',          label: 'Label Stock',  short: 'Stock',    icon: Package },
    { href: '/admin/slips',          label: 'Slips',                           icon: Printer },
    { href: '/admin/dies',           label: 'Dies',                            icon: Scissors },
    { href: '/admin/plates',         label: 'Plates',                          icon: Disc },
    { href: '/admin/shade-cards',    label: 'Shade Cards',  short: 'Shades',   icon: Palette },
    { href: '/admin/job-separation', label: 'Job Separation', short: 'Job Sep', icon: SplitSquareHorizontal },
    // Bill of Material — order value against material cost per job, and the
    // material requests the floor raises from it. Production + Admin only,
    // mirrored by canDeptUseBOM in every /api/bom-* route and by RLS on the
    // bom_* tables. The badge counts requests nobody has answered yet.
    ...(showBom ? [{
      href: '/admin/bom', label: 'BOM', icon: ClipboardList,
      badge: bomPending,
      badgeLabel: (n: number) => `${n} material request${n === 1 ? '' : 's'} awaiting Admin`,
    }] : []),
    // Consolidated dispatch email queue — Dispatch/Admin only, mirrored by
    // canDeptManageDispatchNotifications in every /api/dispatch-notifications
    // route and by RLS on pending_dispatch_notifications. The badge counts
    // parties with an unsent batch waiting.
    ...(showDispatchEmails ? [{
      href: '/admin/dispatch-notifications', label: 'Dispatch Emails', short: 'Dispatch', icon: Truck,
      badge: dispatchPending,
      badgeLabel: (n: number) => `${n} part${n === 1 ? 'y' : 'ies'} with an unsent dispatch email`,
    }] : []),
    // Follow-ups (customer CRM) holds sales/contact data with no reason to be
    // shop-floor-visible — Admin only, mirrored by canDeptManageRegister in
    // every /api/register route and by RLS on the register_* tables. Ordered
    // before Team on request.
    ...(canDeptManageRegister(dept)
      ? [{ href: '/admin/register', label: 'Follow-ups', short: 'Follow', icon: Contact }] : []),
    // Team management touches login accounts directly — Admin only, mirrored
    // by the check in every /api/team route.
    ...(canDeptManageTeam(dept)
      ? [{ href: '/admin/team', label: 'Team', icon: Users }] : []),
    // Create departments and configure their permission grids — the
    // super-admin department only, since this page edits the permission
    // system itself.
    ...(dept.isSuperAdmin
      ? [{ href: '/admin/departments', label: 'Departments', short: 'Depts', icon: Building2 }] : []),
  ];

  // ── Which rung of the ladder ────────────────────────────────────────
  // Three hidden rulers render the strip at full, short and icon width. We
  // take the first that fits the room the header actually has, and fall
  // through to the hamburger when none of them do.
  //
  // Measuring beats a set of fixed breakpoints because the entry count is
  // per-department — a Production login has eight sections where an admin has
  // twelve, and their strips run out of room at genuinely different widths.
  //
  // The strip is `flex-1 min-w-0`, so its width comes from the header and
  // never from its own contents; changing what is inside it therefore cannot
  // feed back into its size, and the observer below cannot loop.
  const shellRef  = useRef<HTMLElement>(null);
  const barRef    = useRef<HTMLDivElement>(null);
  const rulerRefs = {
    full:  useRef<HTMLDivElement>(null),
    short: useRef<HTMLDivElement>(null),
    icon:  useRef<HTMLDivElement>(null),
  };
  // Full names are the server-rendered default: it is the right answer on the
  // wide monitors this runs on, so the common case never corrects itself.
  const [density, setDensity] = useState<Density>('full');

  // Re-measure whenever the entry set changes shape: a permission-gated
  // section appearing, or a badge going from absent to two digits, both
  // change the width a rung needs.
  const navSignature = navItems.map((i) => `${i.href}:${i.badge ?? 0}`).join('|');

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    function evaluate() {
      const avail = shell?.clientWidth ?? 0;
      // Below lg the strip is display:none and reads 0 — nothing to decide,
      // the hamburger owns that range outright.
      if (!avail) return;

      const needs = {
        full:  rulerRefs.full.current?.getBoundingClientRect().width  ?? 0,
        short: rulerRefs.short.current?.getBoundingClientRect().width ?? 0,
        icon:  rulerRefs.icon.current?.getBoundingClientRect().width  ?? 0,
      };
      if (!needs.full) return;

      setDensity((prev) => {
        const prevRung = DENSITY_LADDER.indexOf(prev as typeof DENSITY_LADDER[number]);
        for (let rung = 0; rung < DENSITY_LADDER.length; rung++) {
          const step = DENSITY_LADDER[rung];
          // Climbing back towards fuller names has to clear the margin;
          // stepping down to save space does not.
          const climbing = prevRung === -1 || rung < prevRung;
          if (needs[step] + (climbing ? DENSITY_HYSTERESIS : 0) <= avail) return step;
        }
        return 'menu';
      });
    }

    evaluate();
    const ro = new ResizeObserver(evaluate);
    ro.observe(shell);
    // Web fonts land after first paint and change every name's width, so the
    // first measurement is taken against fallback metrics; redo it once
    // DM Sans is actually in.
    document.fonts?.ready.then(evaluate).catch(() => {});
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navSignature]);

  // On the bottom rung the strip stands down and the hamburger takes over,
  // exactly as it does below lg.
  const useMenu = density === 'menu';
  useEffect(() => {
    if (!useMenu) setMobileOpen(false);
  }, [useMenu]);

  // ── Sliding active indicator ────────────────────────────────────────
  // The only thing in the strip that moves. It is measured rather than
  // animated per-entry so it travels the real distance between two entries of
  // different widths, and it is driven by transform/width on a single element
  // — no layout thrash, and nothing mounts or unmounts.
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) { setIndicator(null); return; }

    function measure() {
      const el = bar?.querySelector<HTMLElement>('[data-bar-active="true"]');
      setIndicator(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
    }

    measure();
    // The strip re-centres as the header's max-width steps up on wide
    // monitors, so the indicator has to follow the element, not a remembered
    // number.
    const ro = new ResizeObserver(measure);
    ro.observe(bar);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => ro.disconnect();
  }, [density, pathname, navSignature]);

  async function handleLogout() {
    await supabase.auth.signOut();
    // Drop every cached response — this is a shared shop-floor terminal, and
    // whoever logs in next must not see a moment of the previous
    // department's job/stock/BOM data from the query cache.
    queryClient.clear();
    router.push('/login');
    router.refresh();
  }

  /** The contents of one entry, at one rung. Rendered both as a real link and
   *  inside the rulers, which is what keeps the measurements truthful. */
  function EntryBody({ item, density }: { item: NavItem; density: Density }) {
    const Icon = item.icon;
    return (
      <>
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        {density !== 'icon' && <span>{labelFor(item, density)}</span>}
        <NavBadge item={item} density={density} />
      </>
    );
  }

  /** A ruler: the whole strip at one rung, laid out where nothing can see it.
   *  `visibility: hidden` (rather than `display: none`) is the point — it
   *  still lays out, so it still has a measurable width, while staying out of
   *  the tab order and the accessibility tree. */
  function Ruler({ at }: { at: typeof DENSITY_LADDER[number] }) {
    return (
      <div
        ref={rulerRefs[at]}
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 flex w-max items-center gap-1"
        style={{ visibility: 'hidden', transform: 'translateX(-200vw)' }}
      >
        {navItems.map((item) => (
          <span key={item.href} className={entryClass(at, false)}>
            <EntryBody item={item} density={at} />
          </span>
        ))}
      </div>
    );
  }

  return (
    <header className="bg-brand-header sticky top-0 z-40 border-b border-white/10">
      <div className="max-w-screen-2xl 3xl:max-w-[1800px] 4xl:max-w-[2200px] mx-auto px-4 h-14 flex items-center gap-3 sm:gap-5">

        <Link href="/admin" aria-label="Go to dashboard" title="Dashboard" className="shrink-0">
          <Logo onDark width={120} height={30} priority />
        </Link>

        {/* flex-1 min-w-0: the strip takes exactly the space the logo and the
            right-hand controls leave it and no more, so it can never push the
            header wide or slide under its neighbours. overflow-x-clip is the
            belt to that braces — for the one frame between a resize and the
            re-measure, an entry is clipped rather than spilling.
            The element stays in the layout even on the `menu` rung, because
            the rulers inside it are what let the strip come back when the
            window grows again. */}
        <nav
          ref={shellRef}
          aria-label="Admin sections"
          className="relative hidden h-full min-w-0 flex-1 overflow-x-clip lg:block"
        >
          {!useMenu && (
            <div
              // Keyed by rung so a step up or down crossfades rather than
              // snapping. Only opacity animates — the header's height never
              // changes, so nothing below it moves during a resize.
              key={density}
              ref={barRef}
              className="nav-swap relative flex h-full items-center gap-1"
            >
              {navItems.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    // On the icon rung the visible glyph carries no text, so
                    // the name has to come from here — as a hover tooltip and
                    // as the accessible name. Harmless on the other rungs.
                    title={item.label}
                    aria-label={item.label}
                    data-bar-active={active}
                    aria-current={active ? 'page' : undefined}
                    className={entryClass(density, active)}
                  >
                    <EntryBody item={item} density={density} />
                  </Link>
                );
              })}

              {/* The indicator sits in the strip's own coordinate space, so it
                  can slide between entries of different widths in one move. */}
              {indicator && (
                <span
                  aria-hidden="true"
                  className="nav-indicator absolute bottom-0 left-0 h-0.5 rounded-full bg-emerald-300"
                  style={{
                    transform: `translateX(${indicator.left}px)`,
                    width: indicator.width,
                  }}
                />
              )}
            </div>
          )}

          <Ruler at="full" />
          <Ruler at="short" />
          <Ruler at="icon" />
        </nav>

        {/* Right side */}
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <span className="text-white/75 text-xs font-mono hidden sm:inline">
            {displayName}
          </span>
          {/* Full-database export — Admin only, mirrored by the check in
              GET /api/export, which is the actual gate. */}
          {canDeptExportData(dept) && <ExportButton />}
          {/* Below lg, and on the menu rung, this moves into the sheet
              instead, sized for a proper tap target there — this compact text
              button only appears beside a strip. */}
          <button
            onClick={handleLogout}
            className={cn(
              'hidden text-white/70 hover:text-white text-xs transition-colors px-2 py-1',
              !useMenu && 'lg:inline-block',
            )}
          >
            Sign out
          </button>

          {/* Hamburger toggle — wherever the strip has stood down, this is the
              only way to reach the sections, so it needs a real 44px tap
              target. */}
          <button
            type="button"
            onClick={() => setMobileOpen((open) => !open)}
            aria-expanded={mobileOpen}
            aria-controls="admin-mobile-nav"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            className={cn(
              'inline-flex items-center justify-center min-h-11 min-w-11 -mr-2 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors',
              !useMenu && 'lg:hidden',
            )}
          >
            {mobileOpen
              ? <X className="h-5 w-5" aria-hidden="true" />
              : <Menu className="h-5 w-5" aria-hidden="true" />}
          </button>
        </div>
      </div>

      {/* Section sheet — the same links and conditions as the strip, stacked
          with full-width 44px rows and always with the full names. */}
      {mobileOpen && (
        <nav
          id="admin-mobile-nav"
          aria-label="Admin sections (menu)"
          className={cn(
            'nav-panel-in border-t border-white/10 bg-brand-header px-4 py-2',
            !useMenu && 'lg:hidden',
          )}
        >
          {navItems.map((item) => (
            <StackedNavLink key={item.href} item={item} pathname={pathname} />
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
