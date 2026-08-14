'use client';
// src/components/admin/AdminHeader.tsx

import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Package, Scissors, Disc, Users, SplitSquareHorizontal, Contact, ClipboardList } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { canDeptUseBOM, type Department } from '@/lib/constants/departments';
import { Logo } from '@/components/brand/Logo';
import ExportButton from './ExportButton';

type Props = {
  dept:        Department;
  displayName: string;
};

// Ctrl/Cmd + letter, site-wide. Keys are safe to claim outright: nobody types
// a bare letter while holding Ctrl, so there's no risk of hijacking normal
// typing in a search box or form field — only the browser's own binding for
// that combo (print, save, bookmark, history) gets overridden.
const SHORTCUTS: Record<string, string> = {
  h: '/admin',
  s: '/admin/stock',
  d: '/admin/dies',
  p: '/admin/plates',
  j: '/admin/job-separation',
  // Not 't' — Ctrl/Cmd+T is "new tab" and browsers never let a page
  // override it, so the shortcut would silently do nothing.
  m: '/admin/team',
  r: '/admin/register',
  b: '/admin/bom',
};

// How often the header re-checks for material requests nobody has answered.
// Slow on purpose: this is a badge, not a wall display, and it rides the
// count-only branch of the API so it never pulls the request bodies.
const BOM_BADGE_POLL_MS = 60_000;

export default function AdminHeader({ dept, displayName }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const queryClient = useQueryClient();

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

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();

      // Ctrl+K focuses whatever search box is on the current page, rather
      // than navigating — every admin page tags its own search input with
      // data-global-search, so there is at most one match at a time.
      if (key === 'k') {
        e.preventDefault();
        const search = document.querySelector<HTMLInputElement>('[data-global-search]');
        search?.focus();
        search?.select();
        return;
      }

      const dest = SHORTCUTS[key];
      if (!dest) return;
      e.preventDefault();
      router.push(dest);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [router]);

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
          <Link href="/admin" aria-label="Go to dashboard" title="Dashboard (Ctrl+H)" className="shrink-0">
            <Logo onDark width={120} height={30} priority />
          </Link>

          {/* Label stock, dies, plates and job separation are readable by
              every department — Dispatch (stock) and Prepress (dies/plates/
              job separation) are the only ones who can change them, enforced
              in /api/stock, /api/dies, /api/plates, /api/job-separations.
              Ctrl/Cmd + letter shortcuts are wired up in the keydown handler
              above — the titles below are just how the team discovers them. */}
          <nav aria-label="Admin sections" className="flex items-center">
            <Link
              href="/admin/stock"
              title="Label Stock (Ctrl+S)"
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-white/75 hover:text-white hover:bg-white/10 transition-colors whitespace-nowrap"
            >
              <Package className="h-4 w-4" aria-hidden="true" />
              Label Stock
            </Link>
            <Link
              href="/admin/dies"
              title="Dies (Ctrl+D)"
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-white/75 hover:text-white hover:bg-white/10 transition-colors whitespace-nowrap"
            >
              <Scissors className="h-4 w-4" aria-hidden="true" />
              Dies
            </Link>
            <Link
              href="/admin/plates"
              title="Plates (Ctrl+P)"
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-white/75 hover:text-white hover:bg-white/10 transition-colors whitespace-nowrap"
            >
              <Disc className="h-4 w-4" aria-hidden="true" />
              Plates
            </Link>
            <Link
              href="/admin/job-separation"
              title="Job Separation (Ctrl+J)"
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-white/75 hover:text-white hover:bg-white/10 transition-colors whitespace-nowrap"
            >
              <SplitSquareHorizontal className="h-4 w-4" aria-hidden="true" />
              Job Separation
            </Link>
            {/* Bill of Material — Production raises material requests here
                and Admin answers them. Production + Admin only, mirrored by
                canDeptUseBOM in every /api/bom-requests route and by RLS on
                the bom_* tables. The badge counts requests nobody has
                acted on yet, so the owner can see work waiting without
                opening the page. */}
            {showBom && (
              <Link
                href="/admin/bom"
                title="Bill of Material (Ctrl+B)"
                className="relative inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-white/75 hover:text-white hover:bg-white/10 transition-colors whitespace-nowrap"
              >
                <ClipboardList className="h-4 w-4" aria-hidden="true" />
                BOM
                {bomPending > 0 && (
                  <span
                    className="ml-0.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-amber-300 px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-[#0A1F18]"
                    aria-label={`${bomPending} request${bomPending === 1 ? '' : 's'} awaiting a decision`}
                  >
                    {bomPending}
                  </span>
                )}
              </Link>
            )}
            {/* Follow-ups (customer CRM) holds sales/contact data with no
                reason to be shop-floor-visible — Admin only, mirrored by
                canDeptManageRegister in every /api/register route and by
                RLS on the register_* tables themselves. Ordered before
                Team on request. */}
            {dept === 'Admin' && (
              <Link
                href="/admin/register"
                title="Follow-ups (Ctrl+R)"
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-white/75 hover:text-white hover:bg-white/10 transition-colors whitespace-nowrap"
              >
                <Contact className="h-4 w-4" aria-hidden="true" />
                Follow-ups
              </Link>
            )}
            {/* Team management touches login accounts directly — Admin only,
                mirrored by the check in every /api/team route. */}
            {dept === 'Admin' && (
              <Link
                href="/admin/team"
                title="Team (Ctrl+M)"
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-white/75 hover:text-white hover:bg-white/10 transition-colors whitespace-nowrap"
              >
                <Users className="h-4 w-4" aria-hidden="true" />
                Team
              </Link>
            )}
          </nav>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          <span className="text-white/75 text-xs font-mono hidden sm:inline">
            {displayName}
          </span>
          {/* Full-database export — Admin only, mirrored by the check in
              GET /api/export, which is the actual gate. */}
          {dept === 'Admin' && <ExportButton />}
          <button
            onClick={handleLogout}
            className="text-white/70 hover:text-white text-xs transition-colors px-2 py-1"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
